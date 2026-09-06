"""
通用的HTTP客户端模块
为所有需要使用httpx的模块提供统一的客户端配置和方法
保持通用性，不与特定业务逻辑耦合
"""

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, Optional

import httpx

from config import get_proxy_config
from log import log


def _env_float(name: str, default: float) -> float:
    """读取浮点环境变量，非法值回退到默认值"""
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        log.warning(f"Invalid {name}={raw!r}, using default {default}")
        return default


def default_stream_timeout() -> httpx.Timeout:
    """流式请求的超时配置。

    ``read`` 是**块与块之间**允许的最大间隔，不是整个响应的上限，所以长生成
    只要上游持续吐字节就不会被切断。

    历史上这里传的是 ``timeout=None``（完全无超时）。上游接受连接后保持静默时，
    ``stream_post_async`` 既不产出数据也不抛异常，于是 ``src/api/*.py`` 的重试循环
    永远等下去：没有 chunk 可转发、没有异常触发换凭证重试、凭证槽位一直被占用。
    客户端只看到“网关卡住了”。见 BYT-918。

    默认值刻意给得很宽：宁可让慢模型多等，也不要把还在思考的请求提前切断。这里要防的
    只是“永远等下去”，不是“等得久”。read=600 意味着上游连续 600 秒一个字节都不吐才判定
    卡死；正常回复通常 7-10 秒就结束。
    """
    return httpx.Timeout(
        connect=_env_float("STREAM_CONNECT_TIMEOUT", 30.0),
        read=_env_float("STREAM_READ_TIMEOUT", 600.0),
        write=_env_float("STREAM_WRITE_TIMEOUT", 300.0),
        pool=_env_float("STREAM_POOL_TIMEOUT", 60.0),
    )


class HttpxClientManager:
    """通用HTTP客户端管理器"""

    async def get_client_kwargs(self, timeout: float = 30.0, **kwargs) -> Dict[str, Any]:
        """获取httpx客户端的通用配置参数"""
        client_kwargs = {"timeout": timeout, **kwargs}

        # 动态读取代理配置，支持热更新
        current_proxy_config = await get_proxy_config()
        if current_proxy_config:
            client_kwargs["proxy"] = current_proxy_config

        return client_kwargs

    @asynccontextmanager
    async def get_client(
        self, timeout: float = 30.0, **kwargs
    ) -> AsyncGenerator[httpx.AsyncClient, None]:
        """获取配置好的异步HTTP客户端"""
        client_kwargs = await self.get_client_kwargs(timeout=timeout, **kwargs)

        async with httpx.AsyncClient(**client_kwargs) as client:
            yield client

    @asynccontextmanager
    async def get_streaming_client(
        self, timeout: Any = None, **kwargs
    ) -> AsyncGenerator[httpx.AsyncClient, None]:
        """获取用于流式请求的HTTP客户端。

        ``timeout=None`` 表示使用 :func:`default_stream_timeout`（有界超时），
        而不是 httpx 的“永不超时”。要显式取消超时必须传 ``httpx.Timeout(None)``。
        """
        if timeout is None:
            timeout = default_stream_timeout()
        client_kwargs = await self.get_client_kwargs(timeout=timeout, **kwargs)

        # 创建独立的客户端实例用于流式处理
        client = httpx.AsyncClient(**client_kwargs)
        try:
            yield client
        finally:
            # 确保无论发生什么都关闭客户端
            try:
                await client.aclose()
            except Exception as e:
                log.warning(f"Error closing streaming client: {e}")


# 全局HTTP客户端管理器实例
http_client = HttpxClientManager()


# 通用的异步方法
async def get_async(
    url: str, headers: Optional[Dict[str, str]] = None, timeout: float = 30.0, **kwargs
) -> httpx.Response:
    """通用异步GET请求"""
    async with http_client.get_client(timeout=timeout, **kwargs) as client:
        return await client.get(url, headers=headers)


async def post_async(
    url: str,
    data: Any = None,
    json: Any = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 900.0,
    **kwargs,
) -> httpx.Response:
    """通用异步POST请求"""
    async with http_client.get_client(timeout=timeout, **kwargs) as client:
        return await client.post(url, data=data, json=json, headers=headers)


# 调试用：设为 True 时所有流式请求都返回 429
_MOCK_STREAM_429 = False

async def stream_post_async(
    url: str,
    body: Dict[str, Any],
    native: bool = False,
    headers: Optional[Dict[str, str]] = None,
    **kwargs,
):
    """流式异步POST请求"""
    if _MOCK_STREAM_429:
        from fastapi import Response
        import json
        log.warning(f"[MOCK] stream_post_async: 返回模拟429错误")
        yield Response(
            content=json.dumps({"error": {"code": 429, "message": "mock rate limit", "status": "RESOURCE_EXHAUSTED"}}),
            status_code=429,
        )
        return

    async with http_client.get_streaming_client(**kwargs) as client:
        async with client.stream("POST", url, json=body, headers=headers) as r:
            # 错误直接返回
            if r.status_code != 200:
                from fastapi import Response
                yield Response(await r.aread(), r.status_code, dict(r.headers))
                return

            # 如果native=True，直接返回bytes流
            if native:
                async for chunk in r.aiter_bytes():
                    yield chunk
            else:
                # 通过aiter_lines转化成str流返回
                async for line in r.aiter_lines():
                    yield line
