import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx


def local_api_url(value: str) -> str:
    url = urlsplit(value)
    if (
        url.scheme not in {"http", "https"}
        or url.hostname not in {"localhost", "127.0.0.1", "::1"}
        or url.username is not None
        or url.password is not None
        or url.query
        or url.fragment
    ):
        raise ValueError("请指定本机 RepoLens HTTP 地址")
    return value.rstrip("/")


def _repo_matches(repo: dict, target: Path) -> bool:
    path = repo.get("local_path")
    if not isinstance(path, str) or not Path(path).is_absolute():
        return False
    try:
        resolved = Path(path).resolve()
        return resolved == target and resolved.is_dir()
    except OSError:
        return False


def _fetch_state(client: httpx.Client, endpoint: str) -> dict:
    response = client.get(f"{endpoint}/state")
    response.raise_for_status()
    state = response.json()
    if not isinstance(state, dict):
        raise ValueError("RepoLens 返回了无效的项目索引状态")
    return state


def _completed(state: dict, expected: str) -> bool:
    summary = state.get("summary_json")
    return (
        state.get("status") == "ready"
        and isinstance(summary, dict)
        and summary.get("team_docs_digest") == expected
    )


def _wait_for_scan(
    client: httpx.Client, endpoint: str, state: dict, deadline: float
) -> dict:
    while state.get("status") == "building" and time.monotonic() < deadline:
        time.sleep(0.25)
        state = _fetch_state(client, endpoint)
    return state


def ensure_index(
    client: httpx.Client, target: Path, expected: str, wait: float = 20
) -> None:
    response = client.get("/api/repos")
    response.raise_for_status()
    repositories = response.json()
    if not isinstance(repositories, list):
        raise ValueError("RepoLens 返回了无效的仓库列表")
    matches = [
        item
        for item in repositories
        if isinstance(item, dict) and _repo_matches(item, target)
    ]
    if len(matches) != 1:
        raise ValueError("请将目标项目唯一连接到本机 RepoLens")
    repo_id = uuid.UUID(str(matches[0].get("id")))
    endpoint = f"/api/repos/{repo_id}/memory-index"
    deadline = time.monotonic() + wait
    state = _wait_for_scan(
        client, endpoint, _fetch_state(client, endpoint), deadline
    )
    if _completed(state, expected):
        return
    if state.get("status") == "building":
        raise ValueError("正在等待项目索引，稍后重试")
    response = client.post(f"{endpoint}/scan")
    response.raise_for_status()
    if response.status_code != 202:
        raise ValueError("RepoLens 未确认接受扫描请求")
    state = _wait_for_scan(client, endpoint, {"status": "building"}, deadline)
    if not _completed(state, expected):
        reason = state.get("error_message") or "尚未确认本次文档索引摘要"
        raise ValueError(str(reason))
