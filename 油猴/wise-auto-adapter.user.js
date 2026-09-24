// ==UserScript==
// @name         AHUT 考勤系统移动端会话自动适配与一键签到助手
// @namespace    https://xskq.ahut.edu.cn/
// @version      1.3.0
// @description  PC端登录自动适配移动端5键存储，支持一键自动化入口（冷启动登录、会话同步、定位状态智能监听、签到状态检测与安全防重提交）
// @match        https://xskq.ahut.edu.cn/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  // 避免在 iframe 中重复执行 (在纯 Node 测试环境中保持兼容)
  if (typeof window !== 'undefined' && typeof window.self !== 'undefined' && typeof window.top !== 'undefined') {
    if (window.self !== window.top) return;
  }

  // -------------------------------------------------------------
  // 0. 全局常量与内存状态 (v1.3.0)
  // -------------------------------------------------------------
  const SCRIPT_VERSION = '1.3.0';
  const LOGIN_URL = "https://xskq.ahut.edu.cn/index/";
  const WQQD_URL = "https://xskq.ahut.edu.cn/wise/pages/ssgl/wqqd";
  const STATE_KEY = 'wise_automation_state';
  const DIAG_KEY = 'wise_automation_diagnostics';
  const MAX_DIAG_EVENTS = 100;
  const TERMINAL_STATUSES = new Set(['success', 'already_done', 'check_complete', 'failed', 'unknown', 'stopped']);

  // 可选内嵌凭据配置：
  // 若填写，将在登录页输入框为空时原生填充并触发提交；留空则优先等待外部密码管理器（如 Edge/Chrome、Bitwarden 等）自动填充。
  const EMBEDDED_CREDENTIALS = {
    studentId: '', // 学号/账号，例如 '2100000000'
    password: ''   // 登录密码
  };

  function getEffectiveCredentials() {
    try {
      if (EMBEDDED_CREDENTIALS.studentId && EMBEDDED_CREDENTIALS.password) {
        return {
          studentId: String(EMBEDDED_CREDENTIALS.studentId).trim(),
          password: String(EMBEDDED_CREDENTIALS.password)
        };
      }
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('wise_embedded_credentials');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.studentId || parsed.username) && parsed.password) {
            return {
              studentId: String(parsed.studentId || parsed.username).trim(),
              password: String(parsed.password)
            };
          }
        }
      }
    } catch (e) {}
    return { studentId: '', password: '' };
  }

  function simulateNativeInput(element, value) {
    if (!element) return;
    try {
      const prototype = Object.getPrototypeOf(element);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    } catch (e) {
      element.value = value;
    }
    if (typeof Event === 'function') {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  let memoryStateBackup = null;
  let opCounter = 0;
  let currentAuthGeneration = 0;
  let activeOpContext = null;
  let isRouteCleaning = false;
  let currentStageInFlight = null;

  // 最早期 BOOT: SCRIPT_ENTRY 诊断记录
  recordBootEvent('BOOT:SCRIPT_ENTRY');

  // -------------------------------------------------------------
  // 1. 轻量纯 JS MD5 实现
  // -------------------------------------------------------------
  function safeMd5(string) {
    function rotateLeft(lValue, iShiftBits) {
      return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
    }
    function addUnsigned(lX, lY) {
      const lX8 = (lX & 0x80000000);
      const lY8 = (lY & 0x80000000);
      const lX4 = (lX & 0x40000000);
      const lY4 = (lY & 0x40000000);
      const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
      if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
      if (lX4 | lY4) {
        if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
      }
      return (lResult ^ lX8 ^ lY8);
    }
    function F(x,y,z) { return (x & y) | ((~x) & z); }
    function G(x,y,z) { return (x & z) | (y & (~z)); }
    function H(x,y,z) { return (x ^ y ^ z); }
    function I(x,y,z) { return (y ^ (x | (~z))); }
    function FF(a,b,c,d,x,s,ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }
    function GG(a,b,c,d,x,s,ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }
    function HH(a,b,c,d,x,s,ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }
    function II(a,b,c,d,x,s,ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }
    function convertToWordArray(str) {
      let lWordCount;
      const lMessageLength = str.length;
      const lNumberOfWords_temp1 = lMessageLength + 8;
      const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
      const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
      const lWordArray = new Array(lNumberOfWords - 1);
      let lBytePosition = 0;
      let lByteCount = 0;
      while (lByteCount < lMessageLength) {
        lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = (lWordArray[lWordCount] | (str.charCodeAt(lByteCount) << lBytePosition));
        lByteCount++;
      }
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
      lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
      lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
      return lWordArray;
    }
    function wordToHex(lValue) {
      let WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
      for (lCount = 0; lCount <= 3; lCount++) {
        lByte = (lValue >>> (lCount * 8)) & 255;
        WordToHexValue_temp = "0" + lByte.toString(16);
        WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
      }
      return WordToHexValue;
    }
    const x = convertToWordArray(unescape(encodeURIComponent(string)));
    let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
    const S11=7, S12=12, S13=17, S14=22;
    const S21=5, S22=9, S23=14, S24=20;
    const S31=4, S32=11, S33=16, S34=23;
    const S41=6, S42=10, S43=15, S44=21;
    for (let k = 0; k < x.length; k += 16) {
      const AA = a, BB = b, CC = c, DD = d;
      a = FF(a,b,c,d,x[k+0], S11,0xD76AA478); d = FF(d,a,b,c,x[k+1], S12,0xE8C7B756);
      c = FF(c,d,a,b,x[k+2], S13,0x242070DB); b = FF(b,c,d,a,x[k+3], S14,0xC1BDCEEE);
      a = FF(a,b,c,d,x[k+4], S11,0xF57C0FAF); d = FF(d,a,b,c,x[k+5], S12,0x4787C62A);
      c = FF(c,d,a,b,x[k+6], S13,0xA8304613); b = FF(b,c,d,a,x[k+7], S14,0xFD469501);
      a = FF(a,b,c,d,x[k+8], S11,0x698098D8); d = FF(d,a,b,c,x[k+9], S12,0x8B44F7AF);
      c = FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1); b = FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
      a = FF(a,b,c,d,x[k+12],S11,0x6B901122); d = FF(d,a,b,c,x[k+13],S12,0xFD987193);
      c = FF(c,d,a,b,x[k+14],S13,0xA679438E); b = FF(b,c,d,a,x[k+15],S14,0x49B40821);
      a = GG(a,b,c,d,x[k+1], S21,0xF61E2562); d = GG(d,a,b,c,x[k+6], S22,0xC040B340);
      c = GG(c,d,a,b,x[k+11],S23,0x265E5A51); b = GG(b,c,d,a,x[k+0], S24,0xE9B6C7AA);
      a = GG(a,b,c,d,x[k+5], S21,0xD62F105D); d = GG(d,a,b,c,x[k+10],S22,0x02441453);
      c = GG(c,d,a,b,x[k+15],S23,0xD8A1E681); b = GG(b,c,d,a,x[k+4], S24,0xE7D3FBC8);
      a = GG(a,b,c,d,x[k+9], S21,0x21E1CDE6); d = GG(d,a,b,c,x[k+14],S22,0xC33707D6);
      c = GG(c,d,a,b,x[k+3], S23,0xF4D50D87); b = GG(b,c,d,a,x[k+8], S24,0x455A14ED);
      a = GG(a,b,c,d,x[k+13],S21,0xA9E3E905); d = GG(d,a,b,c,x[k+2], S22,0xFCEFA3F8);
      c = GG(c,d,a,b,x[k+7], S23,0x676F02D9); b = GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
      a = HH(a,b,c,d,x[k+5], S31,0xFFFA3942); d = HH(d,a,b,c,x[k+8], S32,0x8771F681);
      c = HH(c,d,a,b,x[k+11],S33,0x6D9D6122); b = HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
      a = HH(a,b,c,d,x[k+1], S31,0xA4BEEA44); d = HH(d,a,b,c,x[k+4], S32,0x4BDECFA9);
      c = HH(c,d,a,b,x[k+7], S33,0xF6BB4B60); b = HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
      a = HH(a,b,c,d,x[k+13],S31,0x289B7EC6); d = HH(d,a,b,c,x[k+0], S32,0xEAA127FA);
      c = HH(c,d,a,b,x[k+3], S33,0xD4EF3085); b = HH(b,c,d,a,x[k+6], S34,0x04881D05);
      a = HH(a,b,c,d,x[k+9], S31,0xD9D4D039); d = HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);
      c = HH(c,d,a,b,x[k+15],S33,0x1FA27CF8); b = HH(b,c,d,a,x[k+2], S34,0xC4AC5665);
      a = II(a,b,c,d,x[k+0], S41,0xF4292244); d = II(d,a,b,c,x[k+7], S42,0x432AFF97);
      c = II(c,d,a,b,x[k+14],S43,0xAB9423A7); b = II(b,c,d,a,x[k+5], S44,0xFC93A039);
      a = II(a,b,c,d,x[k+12],S41,0x655B59C3); d = II(d,a,b,c,x[k+3], S42,0x8F0CCC92);
      c = II(c,d,a,b,x[k+10],S43,0xFFEFF47D); b = II(b,c,d,a,x[k+1], S44,0x85845DD1);
      a = II(a,b,c,d,x[k+8], S41,0x6FA87E4F); d = II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);
      c = II(c,d,a,b,x[k+6], S43,0xA3014314); b = II(b,c,d,a,x[k+13],S44,0x4E0811A1);
      a = II(a,b,c,d,x[k+4], S41,0xF7537E82); d = II(d,a,b,c,x[k+11],S42,0xBD3AF235);
      c = II(c,d,a,b,x[k+2], S43,0x2AD7D2BB); b = II(b,c,d,a,x[k+9], S44,0xEB86D391);
      a = addUnsigned(a, AA); b = addUnsigned(b, BB);
      c = addUnsigned(c, CC); d = addUnsigned(d, DD);
    }
    return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
  }

  // -------------------------------------------------------------
  // 2. 异步生命周期管理与定时器统一注册表
  // -------------------------------------------------------------
  const activeTimers = new Set();
  const activeIntervals = new Set();
  const activeAbortControllers = new Set();

  function safeSetTimeout(fn, ms) {
    let id = null;
    id = setTimeout(() => {
      activeTimers.delete(id);
      try {
        fn();
      } catch (e) {
        console.error('[WiseAutomation] safeSetTimeout 异常:', e);
      }
    }, ms);
    activeTimers.add(id);
    return id;
  }

  function safeClearTimeout(id) {
    if (id !== null && id !== undefined) {
      clearTimeout(id);
      activeTimers.delete(id);
    }
  }

  function safeSetInterval(fn, ms) {
    let id = null;
    id = setInterval(() => {
      try {
        fn();
      } catch (e) {
        console.error('[WiseAutomation] safeSetInterval 异常:', e);
      }
    }, ms);
    activeIntervals.add(id);
    return id;
  }

  function safeClearInterval(id) {
    if (id !== null && id !== undefined) {
      clearInterval(id);
      activeIntervals.delete(id);
    }
  }

  function registerAbortController(controller) {
    if (controller) activeAbortControllers.add(controller);
  }

  function unregisterAbortController(controller) {
    if (controller) activeAbortControllers.delete(controller);
  }

  // 新增：定位等待取消回调集合
  const locationWaitCancellers = new Set();

  function registerLocationWaitCanceller(fn) { locationWaitCancellers.add(fn); }
  function unregisterLocationWaitCanceller(fn) { locationWaitCancellers.delete(fn); }

  function cleanupAllAsync() {
    activeTimers.forEach(id => clearTimeout(id));
    activeTimers.clear();

    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals.clear();

    activeAbortControllers.forEach(ctrl => {
      try { ctrl.abort(); } catch (e) {}
    });
    activeAbortControllers.clear();

    // 新增：通知所有等待中的定位 Promise 以 'cancelled' 结束
    locationWaitCancellers.forEach(fn => {
      try { fn(); } catch (e) {}
    });
    locationWaitCancellers.clear();
  }

  // -------------------------------------------------------------
  // 3. 诊断日志子系统 (严格脱敏与白名单限制，上限 100 条)
  // -------------------------------------------------------------
  function getSanitizedPathname() {
    try {
      return (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
    } catch (e) {
      return '';
    }
  }

  function addDiagnosticEvent(event, rawDetails = {}) {
    try {
      const curState = getAutomationState();
      const startTime = curState && curState.startedAt ? curState.startedAt : Date.now();
      const elapsedMs = Math.max(0, Date.now() - startTime);

      // 严格字段白名单，杜绝 Token、密码、Cookie、个人信息与具体经纬度
      const allowedKeys = [
        'reason', 'httpStatus', 'businessCode', 'durationMs', 'errorCode',
        'stage', 'status', 'oldStatus', 'newStatus', 'oldStage', 'newStage',
        'opId', 'authGen', 'inArea', 'distDesc', 'taskName', 'signStartTime',
        'signEndTime', 'timeStr', 'signStatus', 'retryCount', 'source', 'message',
        'locationState', 'readyState', 'hasRunMarker', 'targetMode'
      ];

      const cleanDetails = {};
      for (const key of allowedKeys) {
        if (rawDetails[key] !== undefined && rawDetails[key] !== null) {
          const val = rawDetails[key];
          if (typeof val === 'string') {
            cleanDetails[key] = val.slice(0, 100);
          } else if (typeof val === 'number' || typeof val === 'boolean') {
            cleanDetails[key] = val;
          }
        }
      }

      const effectiveRunId = (curState && curState.runId) ? curState.runId : (rawDetails.runId || 'N/A');
      const effectiveMode = (curState && curState.mode) ? curState.mode : (rawDetails.mode || 'N/A');

      const entry = {
        time: new Date().toISOString(),
        elapsedMs,
        version: SCRIPT_VERSION,
        runId: typeof effectiveRunId === 'string' ? effectiveRunId.slice(0, 60) : 'N/A',
        mode: typeof effectiveMode === 'string' ? effectiveMode.slice(0, 30) : 'N/A',
        event: String(event || 'UNKNOWN').slice(0, 40),
        stage: curState ? curState.stage : (cleanDetails.stage || 'N/A'),
        status: curState ? curState.status : (cleanDetails.status || 'N/A'),
        pathname: getSanitizedPathname(),
        ...cleanDetails
      };

      let history = [];
      try {
        const raw = sessionStorage.getItem(DIAG_KEY);
        if (raw) history = JSON.parse(raw);
        if (!Array.isArray(history)) history = [];
      } catch (e) {
        history = [];
      }

      history.push(entry);
      if (history.length > MAX_DIAG_EVENTS) {
        history = history.slice(-MAX_DIAG_EVENTS);
      }

      sessionStorage.setItem(DIAG_KEY, JSON.stringify(history));
    } catch (e) {
      console.error('[WiseAutomation] 写入诊断失败:', e);
    }
  }

  function getDiagnostics() {
    try {
      const raw = sessionStorage.getItem(DIAG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  function clearDiagnostics() {
    try {
      sessionStorage.removeItem(DIAG_KEY);
    } catch (e) {}
  }

  // 记录最早期生命周期 BOOT 诊断事件 (白名单脱敏)
  function recordBootEvent(event, extra = {}) {
    try {
      const readyState = (typeof document !== 'undefined' && document.readyState) ? document.readyState : 'unknown';
      let hasRunMarker = false;
      let mode = undefined;
      let runId = undefined;

      try {
        if (typeof window !== 'undefined' && window.location && window.location.search) {
          const p = new URLSearchParams(window.location.search);
          hasRunMarker = p.has('wiseRunId');
          if (p.has('wiseRunId')) runId = p.get('wiseRunId');
          if (p.has('wiseMode')) mode = p.get('wiseMode');
        }
      } catch (e) {}

      const bootData = {
        readyState,
        hasRunMarker,
        ...(runId ? { runId } : {}),
        ...(mode ? { mode } : {}),
        ...extra
      };

      addDiagnosticEvent(event, bootData);
    } catch (e) {
      // 容错处理：确保 BOOT 诊断不抛出未捕获异常
    }
  }

  // -------------------------------------------------------------
  // 4. 自动化状态管理与防 Session.clear 拦截保护
  // -------------------------------------------------------------
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.clear) {
      const rawOrigClear = sessionStorage.clear.bind(sessionStorage);
      sessionStorage.clear = function() {
        const stateToKeep = memoryStateBackup || sessionStorage.getItem(STATE_KEY);
        const diagToKeep = sessionStorage.getItem(DIAG_KEY);
        rawOrigClear();
        if (stateToKeep) {
          sessionStorage.setItem(STATE_KEY, typeof stateToKeep === 'string' ? stateToKeep : JSON.stringify(stateToKeep));
        }
        if (diagToKeep) {
          sessionStorage.setItem(DIAG_KEY, diagToKeep);
        }
      };
    }
  } catch(e) {}

  function getAutomationState() {
    try {
      if (typeof sessionStorage === 'undefined') return memoryStateBackup;
      const raw = sessionStorage.getItem(STATE_KEY);
      if (raw) {
        memoryStateBackup = JSON.parse(raw);
        return memoryStateBackup;
      }
      return memoryStateBackup;
    } catch (e) {
      return memoryStateBackup;
    }
  }

  function setAutomationState(state) {
    if (!state) return;
    try {
      state.updatedAt = Date.now();
      state.version = SCRIPT_VERSION;
      memoryStateBackup = state;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
      }
      renderOrUpdateStatusPanel(state);
    } catch (e) {
      console.error('[WiseAutomation] 保存状态失败:', e);
    }
  }

  function isTerminalStatus(status) {
    return TERMINAL_STATUSES.has(status);
  }

  function createOpContext(stage, extra = {}) {
    const cur = getAutomationState();
    opCounter++;
    const ctx = {
      runId: cur ? cur.runId : null,
      stage,
      opId: opCounter,
      authGeneration: currentAuthGeneration,
      isCancelled: false,
      ...extra
    };
    activeOpContext = ctx;
    return ctx;
  }

  function isOpValid(opContext) {
    if (!opContext || opContext.isCancelled) return false;
    const cur = getAutomationState();
    if (!cur || cur.runId !== opContext.runId) return false;
    if (isTerminalStatus(cur.status)) return false;
    if (opContext.authGeneration !== undefined && opContext.authGeneration !== currentAuthGeneration) return false;
    return true;
  }

  function commitState(patch, opContext = null) {
    if (opContext && !isOpValid(opContext)) {
      addDiagnosticEvent('STALE_STATE_DISCARDED', {
        reason: 'op_invalid_or_cancelled',
        stage: opContext.stage,
        opId: opContext.opId
      });
      return false;
    }

    const cur = getAutomationState() || {};

    // 终态不可篡改或复活
    if (isTerminalStatus(cur.status)) {
      addDiagnosticEvent('TERMINAL_STATE_LOCKED', {
        reason: 'already_terminal',
        status: cur.status
      });
      return false;
    }

    const nextState = {
      ...cur,
      ...patch,
      version: SCRIPT_VERSION,
      updatedAt: Date.now()
    };

    if (patch.status && isTerminalStatus(patch.status)) {
      nextState.finishedAt = Date.now();
    }

    setAutomationState(nextState);

    // 进入终态时触发全局资源统一回收
    if (isTerminalStatus(nextState.status)) {
      cleanupAllAsync();
      if (activeOpContext) activeOpContext.isCancelled = true;
      currentStageInFlight = null;
    }

    return true;
  }

  // -------------------------------------------------------------
  // 5. 悬浮状态看板 UI（全周期常驻、终态与脱敏诊断导出）
  // -------------------------------------------------------------
  function renderOrUpdateStatusPanel(state) {
    if (!state) return;
    if (typeof document === 'undefined' || !document.body) {
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', () => renderOrUpdateStatusPanel(state), { once: true });
      }
      return;
    }

    let panel = document.getElementById('wise-automation-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'wise-automation-panel';
      panel.style.position = 'fixed';
      panel.style.bottom = '20px';
      panel.style.right = '20px';
      panel.style.zIndex = '9999999';
      panel.style.minWidth = '330px';
      panel.style.maxWidth = '400px';
      panel.style.background = 'rgba(255, 255, 255, 0.98)';
      panel.style.backdropFilter = 'blur(10px)';
      panel.style.border = '1px solid rgba(0, 0, 0, 0.15)';
      panel.style.borderRadius = '12px';
      panel.style.boxShadow = '0 10px 32px rgba(0, 0, 0, 0.22)';
      panel.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      panel.style.fontSize = '13px';
      panel.style.color = '#1f2937';
      panel.style.overflow = 'hidden';
      panel.style.transition = 'all 0.3s ease';
      document.body.appendChild(panel);
    }

    const isCheckMode = state.mode === 'Check';
    const isTerminal = isTerminalStatus(state.status);

    let badgeColor = isCheckMode ? '#2563eb' : '#059669';
    if (state.status === 'failed' || state.status === 'stopped') badgeColor = '#dc2626';
    else if (state.status === 'already_done') badgeColor = '#4f46e5';
    else if (state.status === 'unknown') badgeColor = '#d97706';

    let statusText = '执行中...';
    if (state.status === 'success') statusText = '✅ 签到成功';
    else if (state.status === 'already_done') statusText = '🎉 今日已签到';
    else if (state.status === 'check_complete') statusText = '🔍 检查完成 (0写入)';
    else if (state.status === 'failed') statusText = '❌ 执行受阻/失败';
    else if (state.status === 'stopped') statusText = '⏹ 已手动停止';
    else if (state.status === 'unknown') statusText = '❓ 提交结果未明 (需查询)';

    const errPrefix = state.errorCode ? `[${state.errorCode}] ` : '';

    panel.innerHTML = `
      <div style="background: ${badgeColor}; color: #ffffff; padding: 10px 14px; font-weight: bold; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
        <span>AHUT 签到自动化 · ${state.mode || 'Run'} (v${SCRIPT_VERSION})</span>
        <span style="font-size: 12px; background: rgba(255,255,255,0.25); padding: 2px 8px; border-radius: 4px;">${statusText}</span>
      </div>
      <div style="padding: 12px 14px;">
        <div style="font-size: 11px; color: #6b7280; margin-bottom: 6px;">运行编号: ${state.runId || 'N/A'}</div>
        <div style="font-weight: 600; color: #111827; margin-bottom: 6px; line-height: 1.4;">${state.stageDesc || '准备中...'}</div>
        <div style="font-size: 12px; color: #4b5563; line-height: 1.4; word-break: break-word;">${errPrefix}${state.message || ''}</div>
        <div style="margin-top: 10px; display: flex; justify-content: flex-end; align-items: center; gap: 8px;">
          <button id="wise-btn-diag" style="border: 1px solid #9ca3af; background: #f3f4f6; color: #374151; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;">
            复制诊断
          </button>
          ${!isTerminal ? `
            <button id="wise-btn-stop" style="border: 1px solid #ef4444; background: #fee2e2; color: #b91c1c; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">
              终止运行
            </button>
          ` : `
            <button id="wise-btn-close" style="border: 1px solid #d1d5db; background: #f3f4f6; color: #374151; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              关闭卡片
            </button>
          `}
        </div>
      </div>
    `;

    const stopBtn = document.getElementById('wise-btn-stop');
    if (stopBtn) {
      stopBtn.onclick = () => {
        cleanupAllAsync();
        if (activeOpContext) activeOpContext.isCancelled = true;
        currentStageInFlight = null;
        commitState({
          status: 'stopped',
          stageDesc: '已手动终止',
          message: '用户已点击终止按钮，后续所有动作已取消。'
        });
        addDiagnosticEvent('TERMINAL', { reason: 'user_stopped' });
      };
    }

    const diagBtn = document.getElementById('wise-btn-diag');
    if (diagBtn) {
      diagBtn.onclick = () => {
        const diagList = getDiagnostics();
        const jsonStr = JSON.stringify(diagList, null, 2);
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(jsonStr).then(() => {
            diagBtn.innerText = '已复制!';
            safeSetTimeout(() => { diagBtn.innerText = '复制诊断'; }, 1500);
          }).catch(() => {
            console.log('[WiseAutomation] 诊断数据:', jsonStr);
            alert('已在 Console 输出脱敏诊断日志');
          });
        } else {
          console.log('[WiseAutomation] 诊断数据:', jsonStr);
          alert('已在 Console 输出脱敏诊断日志');
        }
      };
    }

    const closeBtn = document.getElementById('wise-btn-close');
    if (closeBtn) {
      closeBtn.onclick = () => {
        panel.remove();
      };
    }
  }

  // -------------------------------------------------------------
  // 6. 原有手动入口兼容（保留绿色悬浮直达按钮）
  // -------------------------------------------------------------
  function createFloatingButton(userName) {
    if (typeof document === 'undefined' || !document.body || document.getElementById('wise-adapter-floating-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'wise-adapter-floating-btn';
    btn.style.position = 'fixed';
    btn.style.bottom = '24px';
    btn.style.right = '24px';
    btn.style.zIndex = '999999';
    btn.style.padding = '12px 18px';
    btn.style.borderRadius = '30px';
    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    btn.style.color = '#ffffff';
    btn.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.35)';
    btn.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    btn.style.fontSize = '14px';
    btn.style.fontWeight = 'bold';
    btn.style.cursor = 'pointer';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    btn.style.transition = 'transform 0.2s, box-shadow 0.2s';

    btn.innerHTML = `
      <span style="font-size: 16px;">📍</span>
      <span>直达晚寝签到列表 (${userName}) · 点击进入</span>
    `;

    btn.onmouseover = () => {
      btn.style.transform = 'translateY(-2px) scale(1.02)';
      btn.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.45)';
    };
    btn.onmouseout = () => {
      btn.style.transform = 'translateY(0) scale(1)';
      btn.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.35)';
    };

    btn.onclick = () => {
      location.href = WQQD_URL;
    };

    document.body.appendChild(btn);
  }

  // -------------------------------------------------------------
  // 7. 服务端会话验证与分类（带超时、分类与单次受控重试）
  // -------------------------------------------------------------
  function encodeBase64(str) {
    if (typeof btoa === 'function') return btoa(str);
    if (typeof Buffer !== 'undefined') return Buffer.from(str).toString('base64');
    return str;
  }

  async function verifySession(token, opContext, timeoutMs = 10000) {
    if (!token) return { ok: false, reason: 'no_token', durationMs: 0 };

    const startTime = Date.now();
    let controller = null;
    let timeoutTimer = null;

    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        registerAbortController(controller);
        timeoutTimer = setTimeout(() => {
          try { controller.abort(); } catch (e) {}
        }, timeoutMs);
      }

      const timestamp = Date.now();
      const urlPath = "/api/flySource-base/sysUser/getUserInfo";
      const signPrefix = urlPath + "?sign=";
      const innerHash = safeMd5(timestamp + token);
      const outerHash = safeMd5(signPrefix + innerHash);
      const flySourceSign = outerHash + "1." + encodeBase64(timestamp.toString());

      const clientId = "flySource";
      const clientSecret = "FlySource_SDEKOFSIDF82329F8sd8723dS87DAS";
      const authorization = "Basic " + encodeBase64(`${clientId}:${clientSecret}`);

      const headers = {
        "Accept": "application/json, text/plain, */*",
        "FlySource-Auth": `bearer ${token}`,
        "Authorization": authorization,
        "FlySource-sign": flySourceSign
      };

      const response = await fetch(`https://xskq.ahut.edu.cn${urlPath}`, {
        method: "GET",
        headers,
        credentials: "include",
        signal: controller ? controller.signal : undefined
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          return { ok: false, reason: 'auth_invalid', httpStatus: status, durationMs };
        }
        return { ok: false, reason: 'http_error', httpStatus: status, durationMs };
      }

      let resData = null;
      try {
        resData = await response.json();
      } catch (e) {
        return { ok: false, reason: 'parse_error', httpStatus: response.status, durationMs };
      }

      if (resData && resData.code === 200 && resData.data) {
        return { ok: true, reason: 'ok', data: resData.data, durationMs };
      }

      // 业务码明确为认证异常
      if (resData && (resData.code === 401 || resData.code === 403 || resData.code === 40001)) {
        return { ok: false, reason: 'auth_invalid', businessCode: resData.code, durationMs };
      }

      return {
        ok: false,
        reason: 'business_error',
        businessCode: resData ? resData.code : 'UNKNOWN',
        durationMs
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
        return { ok: false, reason: 'timeout', durationMs };
      }
      return { ok: false, reason: 'network_error', durationMs };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (controller) unregisterAbortController(controller);
    }
  }

  async function verifySessionWithRetry(token, opContext) {
    let result = await verifySession(token, opContext, 10000);

    // 仅针对网络错误、超时或服务端 5xx 进行最多 1 次受控重试；凭据失效绝不重试
    const isTransient = (result.reason === 'network_error' || result.reason === 'timeout' || (result.httpStatus && result.httpStatus >= 500));
    if (!result.ok && isTransient) {
      if (!isOpValid(opContext)) {
        return { ok: false, reason: 'cancelled', durationMs: 0 };
      }
      addDiagnosticEvent('VERIFY_RETRY', {
        reason: result.reason,
        httpStatus: result.httpStatus,
        retryCount: 1
      });

      await new Promise(r => safeSetTimeout(r, 1000));
      if (!isOpValid(opContext)) {
        return { ok: false, reason: 'cancelled', durationMs: 0 };
      }
      result = await verifySession(token, opContext, 10000);
    }

    return result;
  }

  function getLocalPcToken() {
    try {
      const rawAccess = localStorage.getItem("access-token");
      if (!rawAccess) return null;
      const parsed = JSON.parse(rawAccess);
      return parsed.content || rawAccess;
    } catch(e) {
      return localStorage.getItem("access-token");
    }
  }

  function isLoginPage() {
    try {
      if (typeof location === 'undefined') return false;
      return location.pathname.includes('/login') ||
             location.pathname === '/' ||
             location.pathname.startsWith('/index') ||
             (typeof document !== 'undefined' && !!document.querySelector('input[type="password"]'));
    } catch(e) {
      return false;
    }
  }

  // -------------------------------------------------------------
  // 8. PC 端登录处理（单实例互斥、登录代次推进）
  // -------------------------------------------------------------
  function startLoginAutofillWatcher(state) {
    if (!state || isTerminalStatus(state.status)) return;
    if (currentStageInFlight === 'LOGIN') {
      addDiagnosticEvent('DISPATCH_IGNORED', { reason: 'login_already_in_flight' });
      return;
    }

    currentStageInFlight = 'LOGIN';
    const opContext = createOpContext('LOGIN');

    commitState({
      stage: 'LOGIN',
      stageDesc: '等待凭证自动填充',
      message: '等待凭据就绪 (支持内嵌配置 / 密码管理器自动填充)...',
      loginPhase: 'waiting_fill'
    }, opContext);

    addDiagnosticEvent('LOGIN_WATCH_START', { opId: opContext.opId, authGen: opContext.authGeneration });

    const startTime = Date.now();
    const timer = safeSetInterval(() => {
      if (!isOpValid(opContext)) {
        safeClearInterval(timer);
        currentStageInFlight = null;
        return;
      }

      // 若页面已有新 PC Token，说明登录完成
      const token = getLocalPcToken();
      if (token) {
        safeClearInterval(timer);
        currentStageInFlight = null;
        const cur = getAutomationState();
        if (cur) cur.loginPhase = 'completed';
        processSessionAdaptation(cur, token);
        return;
      }

      // 查找表单输入框
      const passInput = document.querySelector('input[type="password"]');
      let userInput = document.querySelector('.login-animation3 input') ||
                       document.querySelector('input[placeholder*="用户名"]') ||
                       document.querySelector('input[placeholder*="账号"]') ||
                       document.querySelector('input[placeholder*="学号"]') ||
                       document.querySelector('input[type="text"]');

      if (!userInput && passInput && passInput.form) {
        userInput = passInput.form.querySelector('input[type="text"]');
      }

      // 尝试内嵌凭据原生模拟填充（仅在输入框为空且存在有效内嵌凭据时触发）
      const creds = getEffectiveCredentials();
      if (userInput && passInput && creds.studentId && creds.password) {
        if (!userInput.value || !passInput.value) {
          simulateNativeInput(userInput, creds.studentId);
          simulateNativeInput(passInput, creds.password);
          addDiagnosticEvent('EMBEDDED_CREDENTIALS_FILLED', { opId: opContext.opId });
        }
      }

      // 若检测到填充值
      if (userInput && passInput && userInput.value && passInput.value) {
        safeClearInterval(timer);

        commitState({
          stageDesc: '检测到凭证已填充',
          message: '已获取自动填充凭证，正在同步表单并触发登录...',
          loginPhase: 'submitting'
        }, opContext);

        userInput.dispatchEvent(new Event('input', { bubbles: true }));
        userInput.dispatchEvent(new Event('change', { bubbles: true }));
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('change', { bubbles: true }));

        safeSetTimeout(() => {
          if (!isOpValid(opContext)) {
            currentStageInFlight = null;
            return;
          }

          const submitBtn = document.querySelector('.login-content-submit') ||
                            document.querySelector('button[type="submit"]') ||
                            Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('登 录') || (b.innerText || '').includes('登录'));

          if (submitBtn && !submitBtn.disabled) {
            addDiagnosticEvent('LOGIN_CLICK', { opId: opContext.opId });
            submitBtn.click();

            let checkCount = 0;
            const tokenCheckTimer = safeSetInterval(() => {
              checkCount++;
              if (!isOpValid(opContext)) {
                safeClearInterval(tokenCheckTimer);
                currentStageInFlight = null;
                return;
              }

              const newToken = getLocalPcToken();
              if (newToken) {
                safeClearInterval(tokenCheckTimer);
                currentAuthGeneration++;
                currentStageInFlight = null;
                const s = getAutomationState();
                if (s) s.loginPhase = 'completed';
                processSessionAdaptation(s, newToken);
              } else if (checkCount > 25) {
                safeClearInterval(tokenCheckTimer);
                currentStageInFlight = null;
                commitState({
                  status: 'failed',
                  errorCode: 'LOGIN_TIMEOUT',
                  stageDesc: '登录响应超时',
                  message: '已触发登录但 12 秒内未检测到有效凭据，请检查密码或验证码。'
                }, opContext);
                addDiagnosticEvent('TERMINAL', { reason: 'login_timeout', errorCode: 'LOGIN_TIMEOUT' });
              }
            }, 500);
          } else {
            currentStageInFlight = null;
            commitState({
              status: 'failed',
              errorCode: 'NO_SUBMIT_BUTTON',
              stageDesc: '未找到登录按钮',
              message: '页面中未发现可点击的登录提交按钮。'
            }, opContext);
            addDiagnosticEvent('TERMINAL', { reason: 'no_submit_button', errorCode: 'NO_SUBMIT_BUTTON' });
          }
        }, 400);
        return;
      }

      // 超时判定 (30s)
      if (Date.now() - startTime > 30000) {
        safeClearInterval(timer);
        currentStageInFlight = null;
        commitState({
          status: 'failed',
          errorCode: 'AUTOFILL_TIMEOUT',
          stageDesc: '等待凭据超时',
          message: '未在 30 秒内检测到有效凭据填充，流程已停止。请检查内嵌配置或手动登录。'
        }, opContext);
        addDiagnosticEvent('TERMINAL', { reason: 'autofill_timeout', errorCode: 'AUTOFILL_TIMEOUT' });
      }
    }, 500);
  }

  // -------------------------------------------------------------
  // 9. 会话适配与直达跳转（拆分验证与写入、旧回调彻底丢弃）
  // -------------------------------------------------------------
  async function processSessionAdaptation(state, token) {
    if (!state || isTerminalStatus(state.status)) return;
    if (currentStageInFlight === 'ADAPT') {
      addDiagnosticEvent('DISPATCH_IGNORED', { reason: 'adapt_already_in_flight' });
      return;
    }

    currentStageInFlight = 'ADAPT';
    const opContext = createOpContext('ADAPT');

    commitState({
      stage: 'ADAPT',
      stageDesc: '同步移动端会话',
      message: '正在验证登录状态并同步移动端会话...'
    }, opContext);

    addDiagnosticEvent('VERIFY_START', { opId: opContext.opId, authGen: opContext.authGeneration });

    const verifyRes = await verifySessionWithRetry(token, opContext);

    if (!isOpValid(opContext)) {
      addDiagnosticEvent('STALE_CALLBACK_DISCARDED', {
        reason: 'verify_returned_after_op_invalid',
        opId: opContext.opId
      });
      currentStageInFlight = null;
      return;
    }

    if (!verifyRes.ok) {
      if (verifyRes.reason === 'network_error' || verifyRes.reason === 'timeout') {
        currentStageInFlight = null;
        commitState({
          status: 'failed',
          errorCode: 'NET_TIMEOUT',
          stageDesc: '网络连接超时',
          message: '网络异常或接口超时 (已重试 1 次)，未修改本地凭据。请检查网络后重试。'
        }, opContext);
        addDiagnosticEvent('TERMINAL', { reason: 'net_timeout', errorCode: 'NET_TIMEOUT' });
        return;
      }

      if (verifyRes.reason === 'http_error' || verifyRes.reason === 'business_error' || verifyRes.reason === 'parse_error') {
        currentStageInFlight = null;
        commitState({
          status: 'failed',
          errorCode: 'SYS_ERROR',
          stageDesc: '服务端响应异常',
          message: `服务端异常 (HTTP: ${verifyRes.httpStatus || 'N/A'}, 业务码: ${verifyRes.businessCode || 'N/A'})，未修改本地凭据。`
        }, opContext);
        addDiagnosticEvent('TERMINAL', { reason: 'sys_error', errorCode: 'SYS_ERROR' });
        return;
      }

      if (verifyRes.reason === 'auth_invalid') {
        addDiagnosticEvent('AUTH_INVALID', { businessCode: verifyRes.businessCode });

        // 仅在明确认证失效时，推进认证代次并清理旧 Token
        currentAuthGeneration++;
        localStorage.removeItem("access-token");
        localStorage.removeItem("wise_Token");
        localStorage.removeItem("isLogin");

        const curState = getAutomationState();
        if (curState && curState.loginPhase === 'completed') {
          currentStageInFlight = null;
          commitState({
            status: 'failed',
            errorCode: 'RELOGIN_AUTH_FAILED',
            stageDesc: '重新登录依然失效',
            message: '已执行重新登录但服务端验证依然未通过，流程终止。'
          }, opContext);
          addDiagnosticEvent('TERMINAL', { reason: 'relogin_auth_failed', errorCode: 'RELOGIN_AUTH_FAILED' });
          return;
        }

        // 前往登录流程
        commitState({
          stage: 'LOGIN',
          stageDesc: '登录态已失效，前往登录',
          message: '检测到浏览器会话已过期，正在前往登录页面等待自动填充...',
          loginPhase: 'navigating_to_login'
        }, opContext);

        currentStageInFlight = null;
        if (!isLoginPage()) {
          location.href = LOGIN_URL;
        } else {
          startLoginAutofillWatcher(getAutomationState());
        }
        return;
      }
    }

    // 验证成功：写入移动端 5 键存储
    const userInfoData = verifyRes.data || {};
    try {
      localStorage.setItem('wise_Token', token);
      localStorage.setItem('isLogin', JSON.stringify({ type: "boolean", data: true }));
      localStorage.setItem('datetime', JSON.stringify({ type: "number", data: Date.now() }));
      localStorage.setItem('wise_Info', JSON.stringify({ type: "object", data: userInfoData }));
      localStorage.setItem('wiseApps', JSON.stringify({ type: "object", data: [] }));
    } catch (e) {
      console.error('[WiseAutomation] 写入 5 键存储失败:', e);
    }

    addDiagnosticEvent('VERIFY_OK', { durationMs: verifyRes.durationMs });

    const userName = userInfoData.userName || userInfoData.accountNo || '用户';

    if (!isOpValid(opContext)) {
      currentStageInFlight = null;
      return;
    }

    commitState({
      stage: 'NAVIGATING',
      stageDesc: '会话就绪，正在打开晚寝列表',
      message: `身份已验证 (${userName})，正在打开晚寝签到列表页...`,
      targetUrl: WQQD_URL
    }, opContext);

    addDiagnosticEvent('NAVIGATING', { target: 'wqqd', url: WQQD_URL });
    currentStageInFlight = null;

    safeSetTimeout(() => {
      if (isOpValid(opContext)) {
        location.href = WQQD_URL;
      } else {
        addDiagnosticEvent('STALE_CALLBACK_DISCARDED', {
          reason: 'nav_delayed_callback_invalid',
          stage: 'NAVIGATING'
        });
      }
    }, 500);
  }

  // -------------------------------------------------------------
  // 10. 晚寝签到列表页处理（等待任务卡片加载、识别并单次点击进入签到页）
  // -------------------------------------------------------------
  function handleWqqdListPage(state) {
    if (!state || isTerminalStatus(state.status)) return;
    if (currentStageInFlight === 'LIST_WAIT' || currentStageInFlight === 'CLICKING_TASK') {
      addDiagnosticEvent('DISPATCH_IGNORED', { reason: 'list_wait_already_in_flight' });
      return;
    }

    currentStageInFlight = 'LIST_WAIT';
    const opContext = createOpContext('LIST_WAIT');

    renderOrUpdateStatusPanel(state);
    commitState({
      stage: 'LIST_WAIT',
      stageDesc: '等待签到任务加载',
      message: '已进入晚寝签到列表，正在检索有效任务...'
    }, opContext);

    addDiagnosticEvent('LIST_WAIT_START', { opId: opContext.opId });

    let checkAttempt = 0;
    const listTimer = safeSetInterval(() => {
      checkAttempt++;
      if (!isOpValid(opContext)) {
        safeClearInterval(listTimer);
        currentStageInFlight = null;
        return;
      }

      const items = Array.from(document.querySelectorAll('.uni-list-item'));
      if (items.length > 0) {
        let matchedItem = null;
        let matchedTitle = '';

        if (items.length === 1) {
          matchedItem = items[0];
          const titleEl = matchedItem.querySelector('.wqqd-item-title') || matchedItem;
          matchedTitle = (titleEl.innerText || '').trim();
        } else {
          // 多个任务时优先过滤晚寝任务
          const candidateItems = items.filter(it => {
            const txt = (it.innerText || '').trim();
            return txt.includes('晚归寝') || txt.includes('晚寝');
          });

          if (candidateItems.length === 1) {
            matchedItem = candidateItems[0];
            const titleEl = matchedItem.querySelector('.wqqd-item-title') || matchedItem;
            matchedTitle = (titleEl.innerText || '').trim();
          } else if (candidateItems.length > 1) {
            // 比对日期范围
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            const activeByDate = candidateItems.filter(it => {
              const dateEl = it.querySelector('.wqqd-item-date');
              const dateTxt = dateEl ? dateEl.innerText : it.innerText;
              const match = (dateTxt || '').match(/(\d{4}-\d{2}-\d{2})\s*至\s*(\d{4}-\d{2}-\d{2})/);
              if (match) {
                return todayStr >= match[1] && todayStr <= match[2];
              }
              return false;
            });

            if (activeByDate.length === 1) {
              matchedItem = activeByDate[0];
              const titleEl = matchedItem.querySelector('.wqqd-item-title') || matchedItem;
              matchedTitle = (titleEl.innerText || '').trim();
            } else {
              safeClearInterval(listTimer);
              currentStageInFlight = null;
              commitState({
                status: 'failed',
                errorCode: 'AMBIGUOUS_TASK_LIST',
                stageDesc: '任务列表存在歧义',
                message: `列表中检测到 ${candidateItems.length} 个晚寝任务候选，无法唯一匹配目标任务。`
              }, opContext);
              addDiagnosticEvent('TERMINAL', { reason: 'ambiguous_task_list', count: candidateItems.length });
              return;
            }
          } else {
            safeClearInterval(listTimer);
            currentStageInFlight = null;
            commitState({
              status: 'failed',
              errorCode: 'NO_MATCHING_TASK',
              stageDesc: '无匹配签到任务',
              message: '列表中未发现包含“晚寝”或“晚归寝”的有效签到任务。'
            }, opContext);
            addDiagnosticEvent('TERMINAL', { reason: 'no_matching_task' });
            return;
          }
        }

        if (matchedItem) {
          safeClearInterval(listTimer);
          currentStageInFlight = 'CLICKING_TASK';

          commitState({
            stage: 'CLICKING_TASK',
            stageDesc: '点击进入签到页',
            message: `已选中任务【${matchedTitle}】，正在点击进入签到详情页...`
          }, opContext);

          addDiagnosticEvent('LIST_ITEM_CLICK', {
            title: matchedTitle,
            opId: opContext.opId
          });

          safeSetTimeout(() => {
            if (!isOpValid(opContext)) {
              currentStageInFlight = null;
              return;
            }
            currentStageInFlight = null;
            try {
              if (typeof matchedItem.click === 'function') {
                matchedItem.click();
              } else {
                matchedItem.dispatchEvent(new Event('click', { bubbles: true }));
              }
            } catch (e) {
              matchedItem.dispatchEvent(new Event('click', { bubbles: true }));
            }
          }, 300);
          return;
        }
      }

      // 检查空列表提示
      const emptyEl = document.querySelector('.uni-load-more') || document.querySelector('.wise-empty');
      if (emptyEl && (emptyEl.innerText || '').includes('暂无数据') && items.length === 0) {
        safeClearInterval(listTimer);
        currentStageInFlight = null;
        commitState({
          status: 'failed',
          errorCode: 'EMPTY_TASK_LIST',
          stageDesc: '签到列表为空',
          message: '当前晚寝签到列表中没有可用任务（显示暂无数据）。'
        }, opContext);
        addDiagnosticEvent('TERMINAL', { reason: 'empty_task_list' });
        return;
      }

      // 超时判定 (20s)
      if (checkAttempt > 50) {
        safeClearInterval(listTimer);
        currentStageInFlight = null;
        commitState({
          status: 'failed',
          errorCode: 'LIST_LOAD_TIMEOUT',
          stageDesc: '列表加载超时',
          message: '20 秒内未能加载晚寝签到列表中的任务条目。'
        }, opContext);
        addDiagnosticEvent('TERMINAL', { reason: 'list_load_timeout', errorCode: 'LIST_LOAD_TIMEOUT' });
      }
    }, 400);
  }

  // -------------------------------------------------------------
  // 11. 目标签到页处理与定位状态智能监听
  // -------------------------------------------------------------
  function handleTargetDormSignPage(state) {
    if (!state || isTerminalStatus(state.status)) return;
    if (currentStageInFlight === 'TARGET_INIT') {
      addDiagnosticEvent('DISPATCH_IGNORED', { reason: 'target_init_already_in_flight' });
      return;
    }

    currentStageInFlight = 'TARGET_INIT';
    const opContext = createOpContext('TARGET_INIT');

    renderOrUpdateStatusPanel(state);
    commitState({
      stage: 'TARGET_INIT',
      stageDesc: '加载签到页数据',
      message: '正在获取今日宿舍签到任务及历史记录...'
    }, opContext);

    let checkAttempt = 0;
    const pageCheckTimer = safeSetInterval(async () => {
      checkAttempt++;
      if (!isOpValid(opContext)) {
        safeClearInterval(pageCheckTimer);
        currentStageInFlight = null;
        return;
      }

      let pageInstance = null;
      if (typeof getCurrentPages === 'function') {
        const pages = getCurrentPages();
        if (pages && pages.length > 0) {
          pageInstance = pages[pages.length - 1];
        }
      }

      if (pageInstance && pageInstance.taskObj && pageInstance.taskObj.taskId && pageInstance.record) {
        safeClearInterval(pageCheckTimer);
        currentStageInFlight = null;
        await evaluateAndProcessCheckIn(getAutomationState(), pageInstance, opContext);
        return;
      }

      const inAreaBtn = document.querySelector('.ds-is-in-area-btn');
      if (inAreaBtn && pageInstance) {
        safeClearInterval(pageCheckTimer);
        currentStageInFlight = null;
        await evaluateAndProcessCheckIn(getAutomationState(), pageInstance, opContext);
        return;
      }

      if (checkAttempt > 60) {
        safeClearInterval(pageCheckTimer);
        currentStageInFlight = null;
        commitState({
          status: 'failed',
          errorCode: 'PAGE_LOAD_TIMEOUT',
          stageDesc: '页面加载超时',
          message: '30 秒内未成功获取到移动端签到页面实例数据。'
        }, opContext);
        addDiagnosticEvent('TERMINAL', { reason: 'page_load_timeout', errorCode: 'PAGE_LOAD_TIMEOUT' });
      }
    }, 500);
  }

  async function waitForLocationReady(page, maxWaitMs = 15000, opContext = null) {
    const startTime = Date.now();
    // ※ 不再主动调用 page.onLocation() ——
    //   页面自身有 setTimeout(onLocation, 2000) 延迟启动定位，
    //   主动调用可能与之重叠，且 onLocation() 内部的互斥锁 (locationIng)
    //   在并发场景下可能导致第二次调用被直接跳过而非排队。

    return new Promise((resolve) => {
      let resolved = false;
      let lastPendingReason = null;      // 仅在状态变化时记录日志
      let sawLocationIngTrue = false;    // 追踪定位流程是否曾经启动
      let timer = null;

      // ── 统一出口：保证每次等待只 resolve 一次 ──
      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        safeClearInterval(timer);
        unregisterLocationWaitCanceller(cancelFn);
        resolve(result);
      };

      // ── 注册取消回调（供 cleanupAllAsync 调用） ──
      const cancelFn = () => {
        finish({ ready: false, inArea: null, reason: 'cancelled', desc: '操作已被终止' });
      };
      registerLocationWaitCanceller(cancelFn);

      function checkLocation() {
        const form = page && page.form;
        const location = page && page.location;

        // ── 1. 追踪 locationIng 状态变化 ──
        //    页面 onLocation() 启动时设置 locationIng = true，
        //    定位成功后才设置回 false。
        //    通过轮询观测，不需要拦截 Vue 2 的 getter/setter。
        if (page && page.locationIng === true) {
          sawLocationIngTrue = true;
        }

        // ── 2. 辅助加速路径：页面主动标记定位失败 ──
        //    逆向源码：validateNull(t) 为 true 时 showRefreshBtn = true，
        //    且此时 locationIng 仍为 true（页面 bug，锁未释放）。
        //    因此该检查放在追踪 locationIng 之后：如果曾启动定位且 showRefreshBtn 为 true，
        //    说明定位回调已执行并失败。
        if (page && page.showRefreshBtn === true && sawLocationIngTrue) {
          return { ready: false, inArea: null, reason: 'location_failed', desc: '页面定位失败，显示刷新按钮' };
        }

        if (page && page.locationIng === true) {
          return { ready: false, inArea: null, reason: 'locating', desc: '页面正在定位中' };
        }

        // ── 3. 坐标尚未有效 → 继续等待 ──
        const lat = form && parseFloat(form.signLat);
        const lng = form && parseFloat(form.signLng);
        const coordsValid = Number.isFinite(lat) && Number.isFinite(lng)
          && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
          && !(lat === 0 && lng === 0);  // (0,0) 视为未初始化
        if (!coordsValid) {
          return { ready: false, inArea: null, reason: 'no_coords', desc: '坐标未就绪' };
        }

        // ── 4. 距离值尚未有效 → 继续等待 ──
        const rawAccuracy = form && form.locationAccuracy;
        if (rawAccuracy === undefined || rawAccuracy === null || rawAccuracy === '') {
          return { ready: false, inArea: null, reason: 'no_distance', desc: '距离计算未完成' };
        }
        const distance = Number(rawAccuracy);
        if (!Number.isFinite(distance) || distance < 0) {
          return { ready: false, inArea: null, reason: 'invalid_distance', desc: '距离值无效' };
        }

        // ── 5. 距离仍为初始化占位值 99999 ──
        //    99999 是页面在 onLocation() 真正回写前的占位值。
        //    仅当定位流程明确跑完一轮（sawLocationIngTrue && locationIng === false）
        //    后 99999 才视为真实计算结果（极端场景）。
        //    正常流程中 onLocation() 成功后会用 getDistance() 覆盖此值。
        const locationRanOnce = sawLocationIngTrue && page && page.locationIng === false;
        if (distance >= 99999 && !locationRanOnce) {
          return { ready: false, inArea: null, reason: 'initial_placeholder', desc: '距离为初始化占位值，等待真实定位结果' };
        }

        // ── 6. 任务允许半径必须来自已加载的任务配置 ──
        //    不再在配置未就绪时默认按 200 米放行。
        const maxDistance = location && location.locationAccuracy != null
          ? Number(location.locationAccuracy)
          : NaN;
        if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
          return { ready: false, inArea: null, reason: 'no_radius', desc: '任务签到半径未加载' };
        }

        // ── 7. 数据完整，判定范围 ──
        //    distance === 0 是合法值（用户恰好在签到点上）。
        const inArea = distance <= maxDistance;
        return {
          ready: true,
          inArea,
          reason: inArea ? 'in_area' : 'out_of_area',
          desc: inArea
            ? `在签到范围内 (距离: ${distance}米, 允许: ${maxDistance}米)`
            : `不在签到范围内 (距离: ${distance}米, 允许: ${maxDistance}米)`
        };
      }

      // ── 记录开始等待 ──
      addDiagnosticEvent('LOCATION_WAIT_START', {});

      // ── 轮询 ──
      timer = safeSetInterval(() => {
        // 取消检查
        if (opContext && !isOpValid(opContext)) {
          finish({ ready: false, inArea: null, reason: 'cancelled', desc: '操作已被终止或失效' });
          return;
        }

        const res = checkLocation();

        // 仅在 pending 原因变化时记录诊断日志，避免每 400ms 刷日志
        if (!res.ready && res.reason !== lastPendingReason) {
          lastPendingReason = res.reason;
          addDiagnosticEvent('LOCATION_PENDING', { reason: res.reason });
        }

        // 定位失败加速路径：showRefreshBtn 触发，无需等到超时
        if (!res.ready && res.reason === 'location_failed') {
          addDiagnosticEvent('LOCATION_ERROR', { reason: res.reason, distDesc: res.desc });
          finish({ ready: false, inArea: null, reason: 'location_failed', desc: res.desc });
          return;
        }

        if (res.ready) {
          addDiagnosticEvent('LOCATION_READY', { inArea: res.inArea, distDesc: res.desc });
          finish(res);
          return;
        }

        // 超时
        if (Date.now() - startTime >= maxWaitMs) {
          const timeoutDesc = `定位获取超时 (${maxWaitMs / 1000}s 未返回有效结果，最后状态: ${res.desc})`;
          addDiagnosticEvent('LOCATION_TIMEOUT', { reason: res.reason, distDesc: timeoutDesc });
          finish({ ready: false, inArea: null, reason: 'timeout', desc: timeoutDesc });
        }
      }, 400);
    });
  }

  async function evaluateAndProcessCheckIn(state, page, opContext) {
    if (!state || isTerminalStatus(state.status)) return;
    if (currentStageInFlight === 'EVALUATING') {
      addDiagnosticEvent('DISPATCH_IGNORED', { reason: 'evaluating_already_in_flight' });
      return;
    }

    currentStageInFlight = 'EVALUATING';
    const evalContext = createOpContext('EVALUATING');

    const taskObj = page.taskObj || {};
    const record = page.record || {};
    const taskName = taskObj.taskName || '晚寝签到';
    const signStartTime = taskObj.signStartTime || '21:30:00';
    const signEndTime = taskObj.signEndTime || '23:30:00';
    const nowDate = page.nowDate || new Date().toISOString().slice(0, 10);

    // 1. 今日已签到拦截
    const isAlreadySigned = (page.isDone === true) || (record.signStatus !== null && [0, 1, 4, 5, 6].includes(record.signStatus));
    if (isAlreadySigned) {
      currentStageInFlight = null;
      commitState({
        status: 'already_done',
        stageDesc: '今日已签到',
        message: `任务【${taskName}】已于今日完成签到 (状态: ${record.signStatusName || '已签'})，无需重复提交。`
      }, evalContext);
      addDiagnosticEvent('TERMINAL', { reason: 'already_done', taskName, signStatus: record.signStatus });
      return;
    }

    // 2. 获取定位信息
    commitState({
      stageDesc: '正在获取位置信息',
      message: '正在等待页面 GPS 定位及签到范围核对 (约需 3~5 秒)...'
    }, evalContext);

    const locResult = await waitForLocationReady(page, 15000, evalContext);

    if (!isOpValid(evalContext)) {
      currentStageInFlight = null;
      return;
    }

    // 计算当前时间字符串（Check 提示与 Run 时间窗口共用）
    const now = new Date();
    const timeStr = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join(':');

    // ── 3. 定位结果判定（Check 与 Run 共用，先于模式分支） ──

    // 3a. 未获得有效定位结果 → 明确失败
    if (!locResult.ready) {
      currentStageInFlight = null;
      const errorCode = locResult.reason === 'timeout' ? 'LOCATION_TIMEOUT'
        : locResult.reason === 'cancelled' ? 'CANCELLED'
        : 'LOCATION_FAILED';
      commitState({
        status: errorCode === 'CANCELLED' ? 'stopped' : 'failed',
        errorCode,
        stageDesc: '定位未完成',
        message: `定位未能获取有效结果: ${locResult.desc}`
      }, evalContext);
      addDiagnosticEvent('TERMINAL', { reason: locResult.reason, errorCode, distDesc: locResult.desc });
      return;
    }

    // 3b. 真实超范围 → 明确失败
    if (!locResult.inArea) {
      currentStageInFlight = null;
      commitState({
        status: 'failed',
        errorCode: 'LOCATION_OUT_OF_BOUNDS',
        stageDesc: '定位未满足',
        message: `定位未通过: ${locResult.desc}`
      }, evalContext);
      addDiagnosticEvent('TERMINAL', {
        reason: 'location_out_of_bounds',
        errorCode: 'LOCATION_OUT_OF_BOUNDS',
        distDesc: locResult.desc
      });
      return;
    }

    // ── 4. Check 模式完成（仅在 ready === true && inArea === true 时才算通过） ──
    if (state.mode === 'Check') {
      currentStageInFlight = null;
      const timeNote = (timeStr < signStartTime || timeStr > signEndTime)
        ? '（注意：当前不在签到时段内）'
        : '';
      commitState({
        status: 'check_complete',
        stageDesc: '检查模式完成',
        message: `【环境就绪】任务: ${taskName}；时段: ${signStartTime} ~ ${signEndTime}；` +
          `定位状态: ${locResult.desc}${timeNote}；Check 模式验证通过，零写入安全退出。`
      }, evalContext);
      addDiagnosticEvent('TERMINAL', {
        reason: 'check_complete',
        inArea: locResult.inArea,
        distDesc: locResult.desc
      });
      return;
    }

    // ── 5. Run 模式：时间窗口核验（后续保持原有逻辑） ──
    if (timeStr < signStartTime) {
      currentStageInFlight = null;
      commitState({
        status: 'failed',
        errorCode: 'TIME_NOT_STARTED',
        stageDesc: '未到签到时间',
        message: `当前时间 (${timeStr}) 尚未到达签到开放时段 (${signStartTime} ~ ${signEndTime})，已安全阻断提交。定位已确认: ${locResult.desc}。`
      }, evalContext);
      addDiagnosticEvent('TERMINAL', { reason: 'time_not_started', timeStr, signStartTime, errorCode: 'TIME_NOT_STARTED' });
      return;
    }

    if (timeStr > signEndTime) {
      currentStageInFlight = null;
      commitState({
        status: 'failed',
        errorCode: 'TIME_EXPIRED',
        stageDesc: '签到时段已结束',
        message: `当前时间 (${timeStr}) 已超过签到截止时间 (${signEndTime})。`
      }, evalContext);
      addDiagnosticEvent('TERMINAL', { reason: 'time_expired', timeStr, signEndTime, errorCode: 'TIME_EXPIRED' });
      return;
    }

    // 6. 防重复提交与 pending 状态保护
    const commitKey = `wise_commit_${taskObj.taskId || 'default'}_${nowDate}`;
    const lastCommit = localStorage.getItem(commitKey);
    if (lastCommit) {
      try {
        const commitInfo = JSON.parse(lastCommit);
        if (commitInfo.status === 'success') {
          currentStageInFlight = null;
          commitState({
            status: 'already_done',
            stageDesc: '防重复提交拦截',
            message: '检测到今日该任务本地已有成功提交记录，阻止重复提交。'
          }, evalContext);
          addDiagnosticEvent('TERMINAL', { reason: 'commit_already_success' });
          return;
        }
        if (commitInfo.status === 'pending') {
          const elapsed = Date.now() - commitInfo.time;
          if (elapsed < 60000) {
            currentStageInFlight = null;
            commitState({
              status: 'failed',
              errorCode: 'COMMIT_IN_FLIGHT',
              stageDesc: '提交已在途中',
              message: '检测到 60 秒内已有正在处理的提交请求，避免并发冲突。'
            }, evalContext);
            addDiagnosticEvent('TERMINAL', { reason: 'commit_in_flight', errorCode: 'COMMIT_IN_FLIGHT' });
            return;
          } else {
            // 超过 60 秒依然未明：绝不自动重新发起，标记 unknown
            currentStageInFlight = null;
            commitState({
              status: 'unknown',
              errorCode: 'PREV_COMMIT_UNCONFIRMED',
              stageDesc: '提交结果未明',
              message: '检测到此前已有提交请求且超时未确认结果。请刷新页面查看实际记录，禁止盲目重复打卡。'
            }, evalContext);
            addDiagnosticEvent('TERMINAL', { reason: 'prev_commit_unconfirmed', errorCode: 'PREV_COMMIT_UNCONFIRMED' });
            return;
          }
        }
      } catch (e) {}
    }

    if (!isOpValid(evalContext)) {
      currentStageInFlight = null;
      return;
    }

    localStorage.setItem(commitKey, JSON.stringify({ time: Date.now(), status: 'pending', runId: state.runId }));

    currentStageInFlight = 'SUBMITTING';
    commitState({
      stage: 'SUBMITTING',
      stageDesc: '正在提交签到',
      message: `各项条件均满足 (${locResult.desc})，正在向服务端发送签到数据...`
    }, evalContext);

    addDiagnosticEvent('SUBMIT_START', { taskId: taskObj.taskId });

    try {
      if (typeof page.submit === 'function') {
        page.submit();
      } else {
        const btn = document.querySelector('.ds-is-in-area-btn') || document.querySelector('.ds-location-btn-err');
        if (btn) btn.click();
        else throw new Error("未找到可触发签到的按钮或方法");
      }

      let waitResultCount = 0;
      const resultTimer = safeSetInterval(() => {
        waitResultCount++;
        if (!isOpValid(evalContext)) {
          safeClearInterval(resultTimer);
          currentStageInFlight = null;
          return;
        }

        if (page.isDone === true || (page.record && [0, 1].includes(page.record.signStatus))) {
          safeClearInterval(resultTimer);
          currentStageInFlight = null;
          localStorage.setItem(commitKey, JSON.stringify({ time: Date.now(), status: 'success', runId: state.runId }));
          commitState({
            status: 'success',
            stageDesc: '签到成功',
            message: `【签到成功】服务端已确认打卡记录写入 (${taskName})！`
          }, evalContext);
          addDiagnosticEvent('TERMINAL', { reason: 'submit_success', taskName });
          return;
        }

        if (waitResultCount > 30) {
          safeClearInterval(resultTimer);
          currentStageInFlight = null;
          commitState({
            status: 'unknown',
            errorCode: 'SUBMIT_TIMEOUT',
            stageDesc: '提交结果未明',
            message: '提交请求已发出，但 15 秒内未获取到明确成功确认。请刷新页面查看签到记录，切勿盲目重复提交。'
          }, evalContext);
          addDiagnosticEvent('TERMINAL', { reason: 'submit_timeout', errorCode: 'SUBMIT_TIMEOUT' });
        }
      }, 500);

    } catch (err) {
      currentStageInFlight = null;
      console.error("[WiseAutomation] 提交出错:", err);
      commitState({
        status: 'failed',
        errorCode: 'SUBMIT_TRIGGER_EXCEPTION',
        stageDesc: '提交触发异常',
        message: `触发提交异常: ${err.message || '未知错误'}`
      }, evalContext);
      addDiagnosticEvent('TERMINAL', { reason: 'submit_trigger_exception', errorCode: 'SUBMIT_TRIGGER_EXCEPTION' });
    }
  }

  // -------------------------------------------------------------
  // 11. 状态分发与路由适配（单入口互斥与整页导航恢复）
  // -------------------------------------------------------------
  function dispatchStage(state) {
    if (!state || isTerminalStatus(state.status)) return;

    const pathname = getSanitizedPathname();
    const isTargetPage = pathname.includes('/wise/pages/ssgl/dormsign');
    const isWqqdPage = pathname.includes('/wise/pages/ssgl/wqqd');
    const isWisePrefix = pathname.startsWith('/wise/');

    addDiagnosticEvent('DISPATCH_STAGE', { pathname, stage: state.stage });

    if (isTargetPage) {
      handleTargetDormSignPage(state);
      return;
    }

    if (isWqqdPage) {
      handleWqqdListPage(state);
      return;
    }

    if (!isWisePrefix) {
      const token = getLocalPcToken();
      if (token) {
        processSessionAdaptation(state, token);
      } else {
        if (isLoginPage()) {
          startLoginAutofillWatcher(state);
        } else {
          const op = createOpContext('LOGIN');
          commitState({
            stage: 'LOGIN',
            stageDesc: '准备登录',
            message: '检测到尚未登录，正在前往登录页面...'
          }, op);
          addDiagnosticEvent('NAVIGATING', { target: 'login' });
          location.href = LOGIN_URL;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 12. 主调度入口与路由监听解耦
  // -------------------------------------------------------------
  let rawPushState = null;
  let rawReplaceState = null;

  function main() {
    recordBootEvent('BOOT:MAIN_ENTER');

    // 1. 捕获启动 URL 参数，并使用原生 replaceState 清理参数，防止触发路由重入
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('wiseRunId')) {
          const runId = urlParams.get('wiseRunId');
          const mode = urlParams.get('wiseMode') || 'Run';
          const targetMode = urlParams.get('wiseTargetMode') || 'Run';

          // 预检模式处理：仅响应接管回执并维持标题，不触发登录/适配/提交，1.5秒后原地重定向至目标业务模式
          if (mode === 'Preflight') {
            recordBootEvent('BOOT:MARKERS_CAPTURED', { runId, mode: 'Preflight', targetMode, hasRunMarker: true });

            // 1. 设置 document.title 携带 WISE_ACK 供启动器轮询
            const ackPrefix = `[WISE_ACK:${runId}]`;
            if (typeof document !== 'undefined') {
              const currentTitle = document.title || '';
              if (!currentTitle.startsWith(ackPrefix)) {
                document.title = currentTitle ? `${ackPrefix} ${currentTitle}` : ackPrefix;
              }
            }

            // 2. 挂载 MutationObserver 防止 SPA 路由组件生命周期覆写 ACK 标题
            let titleObserver = null;
            if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
              try {
                const targetNode = document.querySelector('title') || document.head || document.documentElement;
                if (targetNode) {
                  titleObserver = new MutationObserver(() => {
                    if (document.title && !document.title.startsWith(ackPrefix)) {
                      document.title = `${ackPrefix} ${document.title}`;
                    }
                  });
                  titleObserver.observe(targetNode, { subtree: true, characterData: true, childList: true });
                }
              } catch (e) {}
            }

            // 3. 清理当前页 URL 中的参数
            urlParams.delete('wiseRunId');
            urlParams.delete('wiseMode');
            urlParams.delete('wiseTargetMode');
            const cleanSearch = urlParams.toString() ? '?' + urlParams.toString() : '';
            const cleanUrl = window.location.pathname + cleanSearch + window.location.hash;
            isRouteCleaning = true;
            try {
              if (rawReplaceState) {
                rawReplaceState.call(window.history, null, '', cleanUrl);
              } else if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', cleanUrl);
              }
            } finally {
              isRouteCleaning = false;
            }

            // 4. 保持标题 1.5 秒确保启动器捕获，随后通过 location.replace 原地转入正式业务流程
            safeSetTimeout(() => {
              if (titleObserver) {
                try { titleObserver.disconnect(); } catch (e) {}
              }
              recordBootEvent('BOOT:PREFLIGHT_REDIRECT', { runId, mode: targetMode });

              const targetUrl = new URL(window.location.href);
              targetUrl.searchParams.set('wiseRunId', runId);
              targetUrl.searchParams.set('wiseMode', targetMode);
              const nextBusinessUrl = targetUrl.toString();

              if (typeof window.location.replace === 'function') {
                window.location.replace(nextBusinessUrl);
              } else {
                window.location.href = nextBusinessUrl;
              }
            }, 1500);

            // 预检模式完成早期处理后立即返回，绝不进入后续状态看板或业务调度
            return;
          }

          const newState = {
            schemaVersion: '1.1',
            version: SCRIPT_VERSION,
            runId,
            mode,
            stage: 'INIT',
            status: 'running',
            stageDesc: '自动化已启动',
            message: `已接收运行指令 (模式: ${mode})，正在初始化...`,
            loginPhase: 'idle',
            startedAt: Date.now()
          };

          memoryStateBackup = newState;
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(STATE_KEY, JSON.stringify(newState));
          }

          urlParams.delete('wiseRunId');
          urlParams.delete('wiseMode');
          urlParams.delete('wiseTargetMode');
          const newSearch = urlParams.toString() ? '?' + urlParams.toString() : '';
          const cleanUrl = window.location.pathname + newSearch + window.location.hash;

          isRouteCleaning = true;
          try {
            if (rawReplaceState) {
              rawReplaceState.call(window.history, null, '', cleanUrl);
            } else if (window.history && window.history.replaceState) {
              window.history.replaceState(null, '', cleanUrl);
            }
          } finally {
            isRouteCleaning = false;
          }

          recordBootEvent('BOOT:MARKERS_CAPTURED', { runId, mode, hasRunMarker: true });
          addDiagnosticEvent('INIT', { runId, mode });
        }
      }
    } catch(e) {
      isRouteCleaning = false;
    }

    recordBootEvent('BOOT:INIT_COMPLETE');

    // 2. 读取当前会话自动化状态
    const state = getAutomationState();
    if (state) {
      renderOrUpdateStatusPanel(state);

      if (state.status === 'running') {
        const runDispatch = () => dispatchStage(state);
        if (typeof document !== 'undefined' && document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', runDispatch, { once: true });
        } else {
          runDispatch();
        }
        return;
      }
    }

    // 3. 普通手动访问逻辑：保持原有绿色悬浮直达按钮
    const initManual = () => {
      if (typeof location === 'undefined' || location.pathname.startsWith('/wise/')) return;
      safeSetInterval(() => {
        const token = getLocalPcToken();
        if (!token) return;

        const currentWiseToken = localStorage.getItem("wise_Token");
        const currentIsLogin = localStorage.getItem("isLogin");
        const rawInfo = localStorage.getItem("wise_Info");

        if (currentWiseToken === token && currentIsLogin === '{"type":"boolean","data":true}' && rawInfo) {
          try {
            const infoObj = JSON.parse(rawInfo);
            const name = (infoObj.data && infoObj.data.userName) || "已登录";
            createFloatingButton(name);
          } catch(e) {
            createFloatingButton("已登录");
          }
          return;
        }

        verifySession(token, null, 6000).then(res => {
          if (res.ok && res.data) {
            createFloatingButton(res.data.userName || res.data.accountNo || "用户");
          }
        });
      }, 2000);
    };

    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initManual, { once: true });
    } else {
      initManual();
    }
  }

  // -------------------------------------------------------------
  // 13. 路由监听器（防抖、去重与参数清理过滤）
  // -------------------------------------------------------------
  function setupRouteWatcher() {
    if (typeof window === 'undefined' || !window.history) return;

    let lastPath = getSanitizedPathname();

    const onRoute = () => {
      if (isRouteCleaning) return;

      const currentPath = getSanitizedPathname();
      if (currentPath === lastPath) return;
      lastPath = currentPath;

      const state = getAutomationState();
      if (state && state.status === 'running') {
        addDiagnosticEvent('ROUTE_CHANGE', { toPath: currentPath });
        dispatchStage(state);
      }
    };

    rawPushState = window.history.pushState;
    window.history.pushState = function() {
      rawPushState.apply(this, arguments);
      safeSetTimeout(onRoute, 150);
    };

    rawReplaceState = window.history.replaceState;
    window.history.replaceState = function() {
      rawReplaceState.apply(this, arguments);
      if (!isRouteCleaning) {
        safeSetTimeout(onRoute, 150);
      }
    };

    window.addEventListener('popstate', onRoute);
  }

  // 启动路由监听与主入口
  try {
    setupRouteWatcher();
    recordBootEvent('BOOT:ROUTE_WATCHER_READY');
  } catch (e) {
    recordBootEvent('BOOT:ROUTE_WATCHER_ERROR', { errorCode: 'ROUTE_WATCHER_EXCEPTION' });
  }
  main();

  // -------------------------------------------------------------
  // 14. 模块导出（仅供 Node.js 离线单元测试与回归套件使用）
  // -------------------------------------------------------------
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SCRIPT_VERSION,
      WQQD_URL,
      LOGIN_URL,
      handleWqqdListPage,
      EMBEDDED_CREDENTIALS,
      getEffectiveCredentials,
      simulateNativeInput,
      safeMd5,
      getAutomationState,
      setAutomationState,
      commitState,
      verifySession,
      verifySessionWithRetry,
      processSessionAdaptation,
      startLoginAutofillWatcher,
      handleTargetDormSignPage,
      evaluateAndProcessCheckIn,
      waitForLocationReady,
      dispatchStage,
      main,
      setupRouteWatcher,
      addDiagnosticEvent,
      recordBootEvent,
      getDiagnostics,
      clearDiagnostics,
      cleanupAllAsync,
      isTerminalStatus,
      createOpContext,
      isOpValid,
      resetInternalStateForTest: () => {
        memoryStateBackup = null;
        opCounter = 0;
        currentAuthGeneration = 0;
        activeOpContext = null;
        isRouteCleaning = false;
        currentStageInFlight = null;
        EMBEDDED_CREDENTIALS.studentId = '';
        EMBEDDED_CREDENTIALS.password = '';
        cleanupAllAsync();
      }
    };
  }
})();
