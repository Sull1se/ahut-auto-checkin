# -*- coding: utf-8 -*-
"""
AHUT 晚寝自动签到 - Python 脚本

环境变量：
  STUDENT_IDS         - 学号列表，多个用英文分号分隔（必填）
  PASSWORDS           - 密码列表，多个用英文分号分隔（可选，默认 Ahgydx@920）

【推送配置】（可选）
  SERVERCHAN_SENDKEY  - Server 酱 SendKey（微信公众号日常签到结果推送）
  NTFY_TOPIC          - ntfy 专属频道 Topic（仅在签到失败时发送高优先级强穿透告警）
"""
import asyncio
import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import os
import random
import sys
import time
from urllib.parse import urlparse

import aiohttp

from notifier import Notifier, build_sign_result_text

# ============================================================
# API 与基础常量
# ============================================================

API_BASE_URL = "https://xskq.ahut.edu.cn/api"
WEB_DICT = {
    "token_api": f"{API_BASE_URL}/flySource-auth/oauth/token",
    "task_id_api": f"{API_BASE_URL}/flySource-yxgl/dormSignTask/getStudentTaskPage?userDataType=student&current=1&size=15",
    "auth_check_api": (
        f"{API_BASE_URL}/flySource-base/wechat/getWechatMpConfig"
        "?configUrl=https://xskq.ahut.edu.cn/wise/pages/ssgl/dormsign"
        "?taskId={TASK_ID}&autoSign=1&scanSign=0&userId={STUDENT_ID}"
    ),
    "apiLog_api": f"{API_BASE_URL}/flySource-base/apiLog/save?menuTitle=%E6%99%9A%E5%AF%9D%E7%AD%BE%E5%88%B0",
    "get_location_api": (
        f"{API_BASE_URL}/flySource-yxgl/dormSignTask/getTaskByIdForApp"
        "?taskId={TASK_ID}&signDate={date_str}"
    ),
    "sign_in_api": f"{API_BASE_URL}/flySource-yxgl/dormSignRecord/stuSign",
    "sign_in_result_api": (
        f"{API_BASE_URL}/flySource-yxgl/dormSignStu/getWqdStudentPage"
        "?taskId={TASK_ID}&xhOrXm=&nowDate={date_str}&userDataType=student&current=1&size=100"
    ),
}

UA_LIST = [
    "Mozilla/5.0 (Linux; Android 15; MIX Fold 4 Build/TKQ1.240502.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.137 Mobile Safari/537.36 MicroMessenger/8.0.61.2660(0x28003D37) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64",
    "Mozilla/5.0 (Linux; Android 15; LYA-AL10 Build/HUAWEILYA-AL10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.137 Mobile Safari/537.36 MicroMessenger/8.0.61.2660(0x28003D37) WeChat/arm64 Weixin NetType/5G Language/zh_CN ABI/arm64",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.61(0x18003D29) NetType/WIFI Language/zh_CN",
]

MAX_RETRIES = 4
MAX_TOKEN_RETRIES = 3
MAX_CONCURRENT = 5

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ============================================================
# 数据结构与加密辅助函数
# ============================================================

@dataclass
class User:
    student_Id: int
    alias: str = "用户"
    username: str = ""
    password: str = "Ahgydx@920"
    latitude: float = 0.0
    longitude: float = 0.0
    token: str = None
    taskId: str = None
    room_id: str = ""
    is_encrypted: int = 0
    _session: aiohttp.ClientSession = None

    @property
    def session(self):
        if self._session is None:
            session = aiohttp.ClientSession(headers={
                "User-Agent": random.choice(UA_LIST),
                "authorization": "Basic Zmx5c291cmNlX3dpc2VfYXBwOkRBNzg4YXNkVURqbmFzZF9mbHlzb3VyY2VfZHNkYWREQUlVaXV3cWU=",
                "Content-Type": "application/json;charset=UTF-8",
                "X-Requested-With": "com.tencent.mm",
                "Origin": "https://xskq.ahut.edu.cn",
                "Referer": f"https://xskq.ahut.edu.cn/wise/pages/ssgl/dormsign?&userId={self.student_Id}",
            })
            self._session = session
        else:
            if self.token:
                self._session.headers["flysource-auth"] = f"bearer {self.token}"
        return self._session

    async def close(self):
        if self._session:
            await self._session.close()


def password_md5(pwd: str) -> str:
    return hashlib.md5(pwd.encode("utf-8")).hexdigest()


def generate_sign(url: str, token: str) -> str:
    if not token:
        return ""
    parsed_url = urlparse(url)
    api = parsed_url.path + "?sign="
    timestamp = int(time.time() * 1000)
    inner = f"{timestamp}{token}"
    inner_hash = hashlib.md5(inner.encode("utf-8")).hexdigest()
    raw = f"{api}{inner_hash}"
    final_hash = hashlib.md5(raw.encode("utf-8")).hexdigest()
    encoded_time = base64.b64encode(str(timestamp).encode("utf-8")).decode("utf-8")
    return f"{final_hash}1.{encoded_time}"


def get_time() -> dict:
    now = time.localtime()
    return {
        "date": time.strftime("%Y-%m-%d", now),
        "time": time.strftime("%H:%M:%S", now),
        "full": time.strftime("%Y年%m月%d日 %H:%M:%S", now),
    }


def generate_header(user: User, url: str = None) -> dict:
    header = {}
    if user.token:
        header["flysource-auth"] = f"bearer {user.token}"
        if url:
            header["flysource-sign"] = generate_sign(url, user.token)
    return header


def generate_params(user: User) -> dict:
    return {
        "tenantId": "000000",
        "username": user.student_Id,
        "password": user.password if user.is_encrypted else password_md5(user.password),
        "type": "account",
        "grant_type": "password",
        "scope": "all",
    }


def generate_signCode(timestamp_ms: int) -> str:
    dt = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc) + timedelta(hours=8)
    week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    w = week[dt.weekday()]
    m = month[dt.month - 1]
    tz = "GMT+0800 (中国标准时间)"
    time_str = f"{w} {m} {dt.day:02d} {dt.year} {dt.strftime('%H:%M:%S')} {tz}"
    return hashlib.md5(time_str.encode()).hexdigest()


def generate_stuTaskId(lat, lng, acc, date, taskId, fileId="") -> str:
    data = {
        "latitude": str(lat),
        "longitude": str(lng),
        "locationAccuracy": str(acc),
        "signDate": date,
        "taskId": taskId,
        "fileId": fileId,
    }
    json_str = json.dumps(data, separators=(",", ":"))
    return hashlib.md5(json_str.encode()).hexdigest()


def generate_data(user: User) -> dict:
    # 模拟真实寝室 GPS 随机抖动（±0.0002 度约合 15~20 米范围，严格在宿舍考勤围栏内且防风控）
    signLat = user.latitude + round(random.uniform(-0.0002, 0.0002), 6)
    signLng = user.longitude + round(random.uniform(-0.0002, 0.0002), 6)
    locationAccuracy = round(random.uniform(25, 35), 2)
    return {
        "signType": 0,
        "taskId": user.taskId,
        "signLat": signLat,
        "signLng": signLng,
        "locationAccuracy": locationAccuracy,
        "stuTaskId": generate_stuTaskId(signLat, signLng, locationAccuracy, get_time()["date"], user.taskId),
        "scanCode": "",
        "scanType": "",
        "roomId": user.room_id,
        "signKey": user.room_id,
        "signCode": generate_signCode(int(time.time())),
    }


# ============================================================
# 签到状态机逐步执行
# ============================================================

async def sign_in_by_step(user: User, step: int, sign_lock=None) -> dict:
    # 步骤 0：获取登录 Token
    if step == 0:
        logger.info(f"[{user.alias}] 1/6 获取登录凭证...")
        async with user.session.post(
            url=WEB_DICT["token_api"],
            params=generate_params(user),
            headers=generate_header(user),
        ) as resp:
            token_result = await resp.json()
        if "refresh_token" in token_result:
            user.token = token_result["refresh_token"]
            user.username = token_result.get("userName", "")
            logger.info(f"[{user.alias}] 凭证获取成功")
            return {"success": True, "msg": "", "step": step + 1}
        else:
            error_desc = token_result.get("error_description", "未知错误")
            if "Bad credentials" in error_desc or "用户名或密码错误" in error_desc:
                error_desc = "学号或密码错误"
            logger.error(f"[{user.alias}] 凭证获取失败：{error_desc}")
            return {"success": False, "msg": error_desc, "step": -1}

    # 步骤 1：动态获取今日当期签到任务 ID
    if step == 1:
        logger.info(f"[{user.alias}] 2/6 动态获取签到任务ID...")
        async with user.session.get(
            url=WEB_DICT["task_id_api"],
            headers=generate_header(user, WEB_DICT["task_id_api"]),
        ) as resp:
            task_result = await resp.json()
        if task_result.get("code") == 200:
            records = task_result.get("data", {}).get("records", [{}])
            if records and records[0].get("taskId"):
                user.taskId = records[0].get("taskId")
                logger.info(f"[{user.alias}] 动态任务ID获取成功")
                return {"success": True, "msg": "", "step": step + 1}
            else:
                logger.error(f"[{user.alias}] 未检索到今日有效晚寝签到任务")
                return {"success": False, "msg": "未找到签到任务", "step": step}
        else:
            msg = task_result.get("msg", "")
            if any(k in msg for k in ["请求未授权", "缺失身份信息", "鉴权失败"]):
                logger.warning(f"[{user.alias}] 凭证已失效，重新获取...")
                user.token = ""
                return {"success": False, "msg": "token失效", "step": 0}
            logger.error(f"[{user.alias}] 获取任务ID出错：{msg}")
            return {"success": False, "msg": msg, "step": step}

    # 步骤 2：模拟微信环境验证
    if step == 2:
        logger.info(f"[{user.alias}] 3/6 验证微信环境...")
        url = WEB_DICT["auth_check_api"].format(TASK_ID=user.taskId, STUDENT_ID=user.student_Id)
        async with user.session.get(url=url, headers=generate_header(user, url)) as resp:
            auth_result = await resp.json()
        if auth_result.get("code") == 200:
            logger.info(f"[{user.alias}] 微信环境验证通过")
            return {"success": True, "msg": "", "step": step + 1}
        else:
            msg = auth_result.get("msg", "")
            if any(k in msg for k in ["请求未授权", "缺失身份信息", "鉴权失败"]):
                user.token = ""
                return {"success": False, "msg": "token失效", "step": 0}
            logger.error(f"[{user.alias}] 微信环境验证出错：{msg}")
            return {"success": False, "msg": msg, "step": step}

    # 步骤 3：开启签到时间窗口
    if step == 3:
        logger.info(f"[{user.alias}] 4/6 开启签到时间窗口...")
        async with user.session.post(
            url=WEB_DICT["apiLog_api"],
            headers=generate_header(user, WEB_DICT["apiLog_api"]),
        ) as resp:
            if resp.status == 200:
                logger.info(f"[{user.alias}] 时间窗口已开启")
                return {"success": True, "msg": "", "step": step + 1}
            logger.error(f"[{user.alias}] 开启时间窗口失败")
            return {"success": False, "msg": "开启签到时间窗口失败", "step": step}

    # 步骤 4：获取基准宿舍定位
    if step == 4:
        logger.info(f"[{user.alias}] 5/6 获取基准签到位置...")
        url = WEB_DICT["get_location_api"].format(
            TASK_ID=user.taskId,
            date_str=datetime.now().strftime("%Y-%m-%d"),
        )
        async with user.session.get(url, headers=generate_header(user, url)) as resp:
            location_result = await resp.json()
        if location_result.get("code") == 200:
            dorm = location_result.get("data", {}).get("dormitoryRegisterVO", {})
            user.latitude = float(dorm.get("locationLat", 0))
            user.longitude = float(dorm.get("locationLng", 0))
            user.room_id = dorm.get("roomId", "")
            logger.info(f"[{user.alias}] 位置获取成功（基准定位已就绪）")
            return {"success": True, "msg": "", "step": step + 1}
        else:
            msg = location_result.get("msg", "")
            if any(k in msg for k in ["请求未授权", "缺失身份信息", "鉴权失败"]):
                user.token = ""
                return {"success": False, "msg": "token失效", "step": 0}
            return {"success": False, "msg": "", "step": step + 1}

    # 步骤 5：提交签到数据
    if step == 5:
        async with sign_lock:
            logger.info(f"[{user.alias}] 6/6 提交签到（拟真 GPS 抖动中...）")
            sleep_time = round(random.uniform(3, 8))
            await asyncio.sleep(sleep_time)
            async with user.session.post(
                url=WEB_DICT["sign_in_api"],
                json=generate_data(user),
                headers=generate_header(user, WEB_DICT["sign_in_api"]),
            ) as resp:
                sign_in_result = await resp.json()
            if sign_in_result.get("code") == 200 or "您今天已完成签到" in sign_in_result.get("msg", ""):
                logger.info(f"[{user.alias}] 签到成功！")
                return {"success": True, "msg": "", "step": step + 1}
            else:
                msg = sign_in_result.get("msg", "")
                if any(k in msg for k in ["请求未授权", "缺失身份信息", "鉴权失败"]):
                    user.token = ""
                    return {"success": False, "msg": "token失效", "step": 0}
                if "未到签到时间" in msg:
                    logger.error(f"[{user.alias}] 未到签到开放时间")
                    return {"success": False, "msg": msg, "step": -1}
                logger.error(f"[{user.alias}] 签到提交出错：{msg}")
                return {"success": False, "msg": msg, "step": step}

    return {"success": False, "msg": "", "step": -1}


async def sign_in(user: User, sign_lock=None) -> dict:
    step, retries, token_retries = 0, 0, 0
    error_history = set()
    while retries < MAX_RETRIES and 0 <= step < 6:
        result = await sign_in_by_step(user, step, sign_lock=sign_lock)
        step = result["step"]
        if not result["success"]:
            if result["msg"]:
                error_history.add(result["msg"])
            if step == 0 and token_retries < MAX_TOKEN_RETRIES:
                token_retries += 1
            else:
                retries += 1
        await asyncio.sleep(round(random.uniform(0.5, 2), 2))
    return {
        "success": (step == 6),
        "data": error_history,
    }


def load_users_from_env():
    """从环境变量加载用户列表"""
    student_ids_str = os.environ.get("STUDENT_IDS", "").strip()
    passwords_str = os.environ.get("PASSWORDS", "").strip()

    if not student_ids_str:
        logger.error("环境变量 STUDENT_IDS 未设置！请配置环境变量 STUDENT_IDS。")
        return []

    import re
    student_ids = [s.strip() for s in re.split(r"[;,\n]", student_ids_str) if s.strip()]
    passwords = [p.strip() for p in re.split(r"[;,\n]", passwords_str) if p.strip()]

    users = []
    for i, sid in enumerate(student_ids):
        pwd = passwords[i] if i < len(passwords) else "Ahgydx@920"
        if not sid.isdigit():
            logger.warning(f"用户配置格式不合规（序号 {i + 1}），跳过")
            continue
        alias = f"用户 {i + 1}"
        users.append(User(student_Id=int(sid), alias=alias, password=pwd))
        logger.info(f"已加载用户配置：{alias}")

    return users


# ============================================================
# 主执行入口
# ============================================================

async def main():
    logger.info("=" * 50)
    logger.info("AHUT 晚寝自动签到 - Python 脚本启动")
    logger.info(f"当前时间：{get_time()['full']}")
    logger.info("=" * 50)

    users = load_users_from_env()
    if not users:
        raise RuntimeError("未找到有效用户配置，请检查环境变量 STUDENT_IDS 配置是否正确。")

    sign_lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def limited_sign_in(user):
        async with semaphore:
            return await sign_in(user, sign_lock=sign_lock)

    logger.info(f"开始为 {len(users)} 人执行晚寝签到...")
    start_time = time.time()

    results = await asyncio.gather(*(limited_sign_in(u) for u in users))
    await asyncio.gather(*[user.close() for user in users])

    end_time = time.time()
    elapsed = end_time - start_time
    success_count = sum(1 for r in results if r["success"])

    logger.info("=" * 50)
    logger.info(f"签到完成：共 {len(users)} 人，成功 {success_count} 人，失败 {len(users) - success_count} 人")
    logger.info(f"总耗时：{elapsed:.2f} 秒")

    for user, result in zip(users, results):
        status = "成功" if result["success"] else "失败"
        errors = "、".join(result["data"]) if result["data"] else "无"
        logger.info(f"  {user.alias}: {status} - {errors}")
    logger.info("=" * 50)

    # ---------- 结果通知分发 ----------
    all_success = (success_count == len(users))
    if all_success:
        title = f"✅ AHUT 晚寝签到全部成功（{success_count}/{len(users)}）"
    else:
        title = f"⚠️ AHUT 晚寝签到部分失败（{success_count}/{len(users)}）"

    notify_config = {
        "serverchan": {
            "sendkey": os.environ.get("SERVERCHAN_SENDKEY", "").strip(),
        },
        "ntfy": {
            "topic": os.environ.get("NTFY_TOPIC", "").strip(),
        },
    }

    notifier = Notifier(notify_config)

    # 1. Server 酱日常微信报表
    if notify_config["serverchan"]["sendkey"]:
        logger.info("正在发送 Server 酱日常签到报告...")
        text_content = build_sign_result_text(results, users, elapsed)
        notifier._send_serverchan(title, text_content)

    # 2. ntfy 仅在签到失败时触发 Priority 5 强穿透夜间告警
    if notify_config["ntfy"]["topic"]:
        if not all_success:
            logger.info("检测到签到存在失败人员，正在触发 ntfy 紧急强穿透告警...")
            ntfy_title = "🚨 AHUT 晚寝签到失败告警！"
            failed_items = []
            for user, result in zip(users, results):
                if not result["success"]:
                    err = "、".join(result["data"]) if result["data"] else "未知原因"
                    failed_items.append(f"• 学号 {user.student_Id}（{user.username or '未知'}）：{err}")

            ntfy_body = (
                f"AHUT 晚寝签到未全部成功（成功 {success_count}/{len(users)}）\n\n"
                f"失败人员列表：\n" + "\n".join(failed_items) + "\n\n"
                f"请立即核实！"
            )
            notifier._send_ntfy(
                title=ntfy_title,
                content=ntfy_body,
                priority=5,
                tags=["warning", "rotating_light"],
            )
        else:
            logger.info("签到全部成功，按策略跳过 ntfy 告警推送（仅失败触发）")

    # 若未全部成功，抛出异常让平台感知并记录调用异常
    if not all_success:
        failed_count = len(users) - success_count
        logger.error(f"自动化签到未完全成功：共 {len(users)} 人，失败 {failed_count} 人")
        raise RuntimeError(f"自动化签到未完全成功：共 {len(users)} 人，失败 {failed_count} 人")


if __name__ == "__main__":
    asyncio.run(main())
