from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from app.core.config import settings


class McpClientError(RuntimeError):
    pass


def _supports_asyncio_subprocess() -> bool:
    """asyncio 子进程在 Windows 上只被 ProactorEventLoop 支持。

    uvicorn 的 ``--reload`` 在 Windows 上会切换到 ``WindowsSelectorEventLoopPolicy``，
    此时 ``asyncio.create_subprocess_exec`` 会抛 ``NotImplementedError``。
    """
    if sys.platform != "win32":
        return True
    proactor_loop = getattr(asyncio, "ProactorEventLoop", None)
    return proactor_loop is not None and isinstance(asyncio.get_running_loop(), proactor_loop)


class _ThreadedStdioProcess:
    """同步管道 + 线程的兜底进程包装，用于无法使用 asyncio 子进程的事件循环。"""

    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        self._process = process

    @property
    def returncode(self) -> int | None:
        return self._process.returncode

    def write(self, data: bytes) -> None:
        if self._process.stdin is None:
            raise McpClientError("MCP process has no stdin")
        self._process.stdin.write(data)
        self._process.stdin.flush()

    def readline(self) -> bytes:
        if self._process.stdout is None:
            raise McpClientError("MCP process has no stdout")
        return self._process.stdout.readline()

    def read_stderr(self) -> bytes:
        if self._process.stderr is None:
            return b""
        return self._process.stderr.read()

    def stop(self) -> None:
        if self._process.poll() is None:
            self._process.kill()
        self._process.wait()
        for stream in (self._process.stdin, self._process.stdout, self._process.stderr):
            if stream is not None:
                stream.close()


class StdioMcpClient:
    def __init__(self, command: str | None = None, args: list[str] | None = None, cwd: str | None = None) -> None:
        backend_root = Path(__file__).resolve().parents[2]
        self.command = command or sys.executable
        self.args = args or [str(backend_root / "app" / "mcp" / "memory_server.py")]
        self.cwd = cwd or str(backend_root)
        self._next_id = 1

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        process = await self._start()
        try:
            await self._initialize(process)
            await self._notify(process, "notifications/initialized", {})
            return await self._request(process, "tools/call", {"name": name, "arguments": arguments})
        finally:
            await self._stop(process)

    async def inspect_server(self) -> dict[str, Any]:
        """Perform a real MCP handshake and return the server's advertised tools."""
        process = await self._start()
        try:
            initialize = await self._initialize(process)
            await self._notify(process, "notifications/initialized", {})
            tools = await self._request(process, "tools/list", {})
            return {"initialize": initialize, "tools": tools.get("tools") or []}
        finally:
            await self._stop(process)

    async def _initialize(self, process: Any) -> dict[str, Any]:
        return await self._request(
            process,
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "repolens-web-agent", "version": "0.1.0"},
            },
        )

    async def _start(self) -> Any:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["DATABASE_URL"] = settings.database_url
        env.setdefault("AUTO_SYNC_ENABLED", "false")
        if _supports_asyncio_subprocess():
            return await asyncio.create_subprocess_exec(
                self.command,
                *self.args,
                cwd=self.cwd,
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        return _ThreadedStdioProcess(
            subprocess.Popen(
                [self.command, *self.args],
                cwd=self.cwd,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        )

    async def _notify(self, process: Any, method: str, params: dict[str, Any]) -> None:
        await self._write(process, {"jsonrpc": "2.0", "method": method, "params": params})

    async def _request(self, process: Any, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self._next_id
        self._next_id += 1
        await self._write(process, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        try:
            line = await asyncio.wait_for(self._readline(process), timeout=30)
        except TimeoutError as exc:
            raise McpClientError(f"MCP request timed out: {method}") from exc
        if not line:
            stderr = ""
            try:
                stderr = await asyncio.wait_for(self._read_stderr(process), timeout=5)
            except TimeoutError:
                stderr = ""
            raise McpClientError(f"MCP server closed stdout. {stderr}")
        try:
            response = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise McpClientError(f"MCP server returned an invalid JSON response for {method}") from exc
        if "error" in response:
            error = response["error"]
            raise McpClientError(str(error.get("message") or error))
        return response.get("result") or {}

    async def _readline(self, process: Any) -> bytes:
        if isinstance(process, _ThreadedStdioProcess):
            return await asyncio.to_thread(process.readline)
        if process.stdout is None:
            raise McpClientError("MCP process has no stdout")
        return await process.stdout.readline()

    async def _read_stderr(self, process: Any) -> str:
        if isinstance(process, _ThreadedStdioProcess):
            raw = await asyncio.to_thread(process.read_stderr)
        elif process.stderr is None:
            raw = b""
        else:
            raw = await process.stderr.read()
        return raw.decode("utf-8", errors="replace")

    async def _write(self, process: Any, payload: dict[str, Any]) -> None:
        data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        if isinstance(process, _ThreadedStdioProcess):
            await asyncio.to_thread(process.write, data)
            return
        if process.stdin is None:
            raise McpClientError("MCP process has no stdin")
        process.stdin.write(data)
        await process.stdin.drain()

    async def _stop(self, process: Any) -> None:
        if isinstance(process, _ThreadedStdioProcess):
            await asyncio.to_thread(process.stop)
            return
        if process.returncode is None:
            process.kill()
        await process.wait()
