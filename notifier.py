# -*- coding: utf-8 -*-
"""
AHUT 晚寝签到结果通知模块
支持通道：
  1. Server酱微信推送（日常详细报表）
  2. ntfy 移动端强穿透告警（仅在签到失败时触发高优先级免打扰穿透提醒）
"""
import json
import logging
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)


class Notifier:
    """签到结果通知器"""

    def __init__(self, config=None):
        self.config = config or {}
        self.scfgs = self.config.get("serverchan", {})
        self.ntfy_cfg = self.config.get("ntfy", {})

    # ---------- Server酱微信推送 ----------

    def _send_serverchan(self, title, content):
        """通过 Server 酱发送微信推送"""
        sendkey = self.scfgs.get("sendkey", "").strip()
        if not sendkey:
            logger.warning("Server酱 SendKey 未配置，跳过推送")
            return False

        url = f"https://sctapi.ftqq.com/{sendkey}.send"
        data = urllib.parse.urlencode({
            "title": title,
            "desp": content
        }).encode("utf-8")

        try:
            req = urllib.request.Request(url, data=data, method="POST")
            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            if result.get("code") == 0:
                logger.info("Server酱微信推送成功")
                return True
            else:
                logger.error(f"Server酱推送失败: {result.get('message', '未知错误')}")
                return False
        except Exception as e:
            logger.error(f"Server酱推送网络异常: {e}")
            return False

    # ---------- ntfy 移动端强穿透通知 ----------

    def _send_ntfy(self, title, content, priority=5, tags=None):
        """通过 ntfy 发送强提醒告警（支持夜间免打扰穿透与高优先级响铃）"""
        topic = self.ntfy_cfg.get("topic", "").strip()
        if not topic:
            logger.warning("ntfy Topic 未配置，跳过 ntfy 发送")
            return False

        server = self.ntfy_cfg.get("server", "https://ntfy.sh").rstrip("/")
        # ntfy 官方 JSON 发布规范：必须 POST 到根端点（如 https://ntfy.sh），由 JSON 体内的 "topic" 指定目标
        # 若拼接 /topic，服务端将 Body 视为 Raw 纯文本，会导致 priority 丢失降级为默认 3
        url = f"{server}"

        if tags is None:
            tags = ["warning", "rotating_light"]
        elif isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]

        payload = {
            "topic": topic,
            "title": title,
            "message": content,
            "priority": int(priority),
            "tags": tags,
        }

        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "AHUT-AutoCheckIn-Actions/2.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if 200 <= resp.status < 300:
                    logger.info("ntfy 紧急强穿透告警推送成功")
                    return True
                else:
                    logger.error(f"ntfy 推送返回非正常状态码: {resp.status}")
                    return False
        except Exception as e:
            logger.error(f"ntfy 推送网络异常: {e}")
            return False


def build_sign_result_text(results, users, elapsed):
    """构建用于 Server 酱的 Markdown 格式签到结果报告"""
    success_count = sum(1 for r in results if r["success"])
    total = len(results)
    lines = [
        "## AHUT 晚寝自动签到结果",
        "",
        f"- **总人数**：{total}",
        f"- **成功**：{success_count}",
        f"- **失败**：{total - success_count}",
        f"- **总耗时**：{elapsed:.2f} 秒",
        "",
        "### 详细名单",
        "",
        "| 学号 | 姓名 | 状态 | 备注 |",
        "| :--- | :--- | :---: | :--- |",
    ]
    for user, result in zip(users, results):
        status = "✅ 成功" if result["success"] else "❌ 失败"
        detail = "、".join(result["data"]) if result["data"] else "正常"
        lines.append(f"| {user.student_Id} | {user.username or '未知'} | {status} | {detail} |")

    return "\n".join(lines)
