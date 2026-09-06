"""
统一的健康检查（Hi消息）处理模块

提供对OpenAI、Gemini和Anthropic格式的Hi消息的解析和响应
"""
import time
from typing import Any, Dict, List, Optional


# ==================== Hi消息检测 ====================

def is_health_check_request(request_data: dict, format: str = "openai") -> bool:
    """
    检查是否是健康检查请求（Hi消息）
    
    Args:
        request_data: 请求数据
        format: 请求格式（"openai"、"gemini" 或 "anthropic"）
        
    Returns:
        是否是健康检查请求
    """
    if format == "openai":
        # OpenAI格式健康检查: {"messages": [{"role": "user", "content": "Hi"}]}
        messages = request_data.get("messages", [])
        if len(messages) == 1:
            msg = messages[0]
            if msg.get("role") == "user" and msg.get("content") == "Hi":
                return True
                
    elif format == "gemini":
        # Gemini格式健康检查: {"contents": [{"role": "user", "parts": [{"text": "Hi"}]}]}
        contents = request_data.get("contents", [])
        if len(contents) == 1:
            content = contents[0]
            if (content.get("role") == "user" and 
                content.get("parts", [{}])[0].get("text") == "Hi"):
                return True
    
    elif format == "anthropic":
        # Anthropic格式健康检查: {"messages": [{"role": "user", "content": "Hi"}]}
        messages = request_data.get("messages", [])
        if (len(messages) == 1 
            and messages[0].get("role") == "user" 
            and messages[0].get("content") == "Hi"):
            return True
    
    return False


def find_empty_request_reason(request_data: dict, format: str = "openai") -> Optional[str]:
    """返回“这个请求上游必定拒绝”的原因，能正常处理则返回 None。

    空请求不是一次廉价的探活。它会走完整条链路：刷新 token、占用一个凭证、发一次上游
    往返、拿回 Google 的 400 INVALID_ARGUMENT，最后把 error_codes:[400] 写到一个完全
    健康的凭证上。2026-09-06 就有一个 node 客户端用空 contents 扫了约 40 个模型，于是
    面板里每个凭证看起来都在报错，而模型本身其实好好的（同样的模型换成正常 body 直接
    返回 200）。

    在本地直接拒掉，既不花凭证，也不污染凭证状态。注意这不同于
    :func:`is_health_check_request`：那是“假装成功”的探活捷径，而这里是客户端确实发错了，
    必须让它看到 400。见 BYT-918。
    """
    if format == "gemini":
        contents = request_data.get("contents")
        if not contents:
            return "contents must not be empty"
        if all(not (item or {}).get("parts") for item in contents):
            return "contents must contain at least one part"
    elif format in ("openai", "anthropic"):
        messages = request_data.get("messages")
        if not messages:
            return "messages must not be empty"
    return None


def is_health_check_message(messages: List[Dict[str, Any]]) -> bool:
    """
    直接检查消息列表是否为健康检查消息（Anthropic专用）
    
    这是一个便捷函数，用于已经提取出消息列表的场景。
    
    Args:
        messages: 消息列表
        
    Returns:
        是否为健康检查消息
    """
    return (
        len(messages) == 1 
        and messages[0].get("role") == "user" 
        and messages[0].get("content") == "Hi"
    )


# ==================== Hi消息响应生成 ====================

def create_health_check_response(format: str = "openai", **kwargs) -> dict:
    """
    创建健康检查响应
    
    Args:
        format: 响应格式（"openai"、"gemini" 或 "anthropic"）
        **kwargs: 格式特定的额外参数
            - model: 模型名称（anthropic格式需要）
            - message_id: 消息ID（anthropic格式需要）
        
    Returns:
        健康检查响应字典
    """
    if format == "openai":
        # OpenAI格式响应
        return {
            "id": "healthcheck",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "healthcheck",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "API is working"
                },
                "finish_reason": "stop"
            }]
        }
    
    elif format == "gemini":
        # Gemini格式响应
        return {
            "candidates": [{
                "content": {
                    "parts": [{"text": "gcli2api工作中"}],
                    "role": "model"
                },
                "finishReason": "STOP",
                "index": 0,
            }]
        }
    
    elif format == "anthropic":
        # Anthropic格式响应
        model = kwargs.get("model", "claude-unknown")
        message_id = kwargs.get("message_id", "msg_healthcheck")
        return {
            "id": message_id,
            "type": "message",
            "role": "assistant",
            "model": str(model),
            "content": [{"type": "text", "text": "antigravity Anthropic Messages 正常工作中"}],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 0, "output_tokens": 0},
        }
    
    # 未知格式返回空字典
    return {}
