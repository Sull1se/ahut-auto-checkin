/**
 * 微信服务移动端 (/wise/) 本地会话一键适配脚本 (Console 控制台版)
 * 目标站点：https://xskq.ahut.edu.cn
 *
 * 使用方法：
 * 1. 打开 Chrome/Edge 开发者工具 (F12)，切换到移动端仿真视口（Mobile Device Toolbar）
 * 2. 访问 PC 端入口 https://xskq.ahut.edu.cn/index 正常输入账号密码登录
 * 3. 登录成功后，在开发者工具 Console (控制台) 粘贴本脚本全文并回车
 * 4. 弹出确认框后点击确定，即可直接跳转进入移动端 /wise/
 */
(async function autoInjectWiseSession() {
  console.log("%c[WiseAdapter] 开始执行移动端会话适配...", "color: #1e88e5; font-weight: bold;");

  if (location.origin !== "https://xskq.ahut.edu.cn") {
    console.error("[WiseAdapter] 错误：当前不在目标站点域名 (https://xskq.ahut.edu.cn)！");
    alert("请在 https://xskq.ahut.edu.cn/index 页面登录后再执行此脚本！");
    return;
  }

  // 1. 读取 PC 端的登录凭证 access-token
  const rawAccess = localStorage.getItem("access-token");
  if (!rawAccess) {
    console.error("[WiseAdapter] 未检测到 /index 登录凭证，请先在网页上登录账号！");
    alert("未检测到登录凭证，请先在 /index 登录你的账号密码！");
    return;
  }

  let token = null;
  try {
    const parsed = JSON.parse(rawAccess);
    token = parsed.content || parsed;
  } catch (e) {
    token = rawAccess;
  }

  if (!token) {
    console.error("[WiseAdapter] 解析 access-token 失败！");
    alert("解析 access-token 失败，请重新登录！");
    return;
  }

  // 2. 动态加载系统自带的 MD5 模块计算签名
  let md5;
  try {
    const md5Module = await import('/js/js-md5-B4ePrH8J.js');
    md5 = md5Module.a;
  } catch (e) {
    console.error("[WiseAdapter] 无法加载 MD5 模块:", e);
  }

  const timestamp = Date.now();
  const urlPath = "/api/flySource-base/sysUser/getUserInfo";
  let flySourceSign = "";
  if (typeof md5 === "function") {
    const signPrefix = urlPath + "?sign=";
    const innerHash = md5(timestamp + token);
    const outerHash = md5(signPrefix + innerHash);
    flySourceSign = outerHash + "1." + btoa(timestamp.toString());
  }

  const clientId = "flySource";
  const clientSecret = "FlySource_SDEKOFSIDF82329F8sd8723dS87DAS";
  const authorization = "Basic " + btoa(`${clientId}:${clientSecret}`);

  const headers = {
    "Accept": "application/json, text/plain, */*",
    "FlySource-Auth": `bearer ${token}`,
    "Authorization": authorization
  };
  if (flySourceSign) {
    headers["FlySource-sign"] = flySourceSign;
  }

  console.log("[WiseAdapter] 正在向服务器校验 Token 并拉取当前用户信息...");
  let userInfoData = null;
  try {
    const response = await fetch(`https://xskq.ahut.edu.cn${urlPath}`, {
      method: "GET",
      headers,
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(`HTTP 状态码异常: ${response.status}`);
    }

    const resData = await response.json();
    if (resData.code !== 200 || !resData.data) {
      throw new Error(`接口业务错误: ${resData.msg || resData.code}`);
    }
    userInfoData = resData.data;
  } catch (err) {
    console.error("[WiseAdapter] 获取用户信息失败:", err);
    alert("Token 验证失败或接口请求异常：" + err.message);
    return;
  }

  // 3. 备份原状态
  const targetKeys = ['wise_Token', 'wise_Info', 'isLogin', 'datetime', 'wiseApps'];
  const backup = {};
  for (const k of targetKeys) {
    backup[k] = { exists: k in localStorage, val: localStorage.getItem(k) };
  }
  localStorage.setItem('__wise_adapter_backup__', JSON.stringify(backup));

  // 4. 按 uni-app H5 格式规范写入 5 个键
  const now = Date.now();
  localStorage.setItem('wise_Token', token);
  localStorage.setItem('isLogin', JSON.stringify({ type: "boolean", data: true }));
  localStorage.setItem('datetime', JSON.stringify({ type: "number", data: now }));
  localStorage.setItem('wise_Info', JSON.stringify({ type: "object", data: userInfoData }));
  localStorage.setItem('wiseApps', JSON.stringify({ type: "object", data: [] }));

  // 5. 挂载回退函数供应急使用
  window.__wise_rollback = function() {
    const bRaw = localStorage.getItem('__wise_adapter_backup__');
    if (!bRaw) return console.warn("未找到备份记录");
    const b = JSON.parse(bRaw);
    for (const [k, item] of Object.entries(b)) {
      if (item.exists) localStorage.setItem(k, item.val);
      else localStorage.removeItem(k);
    }
    localStorage.removeItem('__wise_adapter_backup__');
    console.log("已恢复移动端原始本地存储状态");
  };

  console.log("%c[WiseAdapter] ✅ 移动端本地会话适配成功！", "color: #2e7d32; font-weight: bold;");
  console.log(`[WiseAdapter] 姓名: ${userInfoData.userName || '未知'} | 学工号: ${userInfoData.accountNo || '未知'}`);

  const TARGET_SIGN_URL = "https://xskq.ahut.edu.cn/wise/pages/ssgl/dormsign?taskId=ebf794a5c9f6bff2575114ada2339658&autoSign=1&scanSign=0";
  const willRedirect = confirm(`移动端会话适配成功（${userInfoData.userName || userInfoData.accountNo}）！\n\n点击【确定】立即直达宿舍签到页面？`);
  if (willRedirect) {
    location.href = TARGET_SIGN_URL;
  }
})();
