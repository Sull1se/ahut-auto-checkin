# -*- coding: utf-8 -*-
"""
华为云函数工作流 (FunctionGraph) - 入口适配文件
函数执行入口: index.handler
"""
import asyncio
import os
import sys

# 确保当前目录及依赖库优先加载
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from main import main as sign_main


def handler(event, context):
    """
    华为云 FunctionGraph 事件函数入口
    :param event: 触发事件数据 (dict)
    :param context: 运行时上下文 (包含 request_id, function_name 等)
    """
    req_id = getattr(context, "request_id", "unknown-req-id")
    print("=" * 60)
    print(f"华为云 FunctionGraph 签到触发，RequestId: {req_id}")
    print("=" * 60)

    try:
        # 执行异步打卡主逻辑
        asyncio.run(sign_main())
        print("签到任务已完整执行结束。")
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json; charset=utf-8"},
            "body": "sign-in completed",
        }
    except Exception as e:
        print(f"签到任务执行异常: {e}")
        # 重新抛出异常让平台捕获并标记为执行失败，便于监控与告警
        raise e


if __name__ == "__main__":
    class MockContext:
        request_id = "local-test-req"

    print("本地直接调用测试：")
    handler({}, MockContext())
