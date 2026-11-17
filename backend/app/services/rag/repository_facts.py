"""Read live repository facts without consulting historical document chunks."""

import asyncio
import re
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.db.models import Repository
from app.services.code_search import repository_checkout_path


def is_latest_commit_question(question: str) -> bool:
    text = question.lower().strip()
    if not re.search(r"(?<![a-z])commits?(?![a-z])|提交", text):
        return False
    if not re.search(
        r"\b(?:last|latest)\b|most\s+recent|最近|最新|最后|上次", text
    ):
        return False
    # Requests about conventions or document history still belong
    # to document QA.
    if re.search(
        (
            "规范|规则|格式|流程|文档中|资料中|手册|commitlint|convention|"
            "format|how to"
        ),
        text,
    ):
        return False
    if re.search(
        r"(?:最近|最新|最后)\s*(?:[1-9]\d+|[2-9]|[二三四五六七八九十几多])|last\s+(?:[1-9]\d+|[2-9])",
        text,
    ):
        return False
    if re.search(
        (
            "(?<![a-z])(?:issues?|prs?|pull requests?|comments?)(?![a-z])|"
            "工单|评论|评审|提交(?:的)?(?:问题|任务)"
        ),
        text,
    ):
        return False
    if re.search(
        (
            "哪些文件|改了什么|修改了什么|修改内容|diff|changed files|"
            "what.*chang"
        ),
        text,
    ):
        return False
    return True


def read_latest_local_commit(repo: Repository) -> dict[str, str]:
    root = repository_checkout_path(repo)
    if not root.is_dir() or not (root / ".git").exists():
        raise ValueError("当前仓库尚无可用的本地 Git checkout，请先同步仓库。")

    def git(*args: str) -> str:
        result = subprocess.run(
            ["git", "--no-pager", *args],
            cwd=root,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        return result.stdout.rstrip("\r\n")

    # Do not accidentally read an enclosing repository when a
    # checkout is missing.
    if root != Path(git("rev-parse", "--show-toplevel")).resolve():
        raise ValueError(
            "当前配置路径与 Git 仓库根目录不一致，请检查仓库配置。"
        )
    output = git(
        "log",
        "-1",
        "--no-show-signature",
        "--format=%H%x00%cI%x00%aI%x00%an%x00%s",
        "HEAD",
        "--",
    )
    sha, committed_at, authored_at, author, subject = output.split("\x00", 4)
    branch = git("branch", "--show-current") or "detached HEAD"
    return {
        "sha": sha,
        "committed_at": committed_at,
        "authored_at": authored_at,
        "author": author,
        "subject": subject,
        "branch": branch,
    }


async def answer_latest_commit(
    repo: Repository, question: str
) -> dict[str, Any]:
    started = time.perf_counter()
    queried_at = datetime.now(timezone.utc).isoformat()
    config: dict[str, Any] = {
        "strategy": "repository_git",
        "repo_id": str(repo.id),
        "scope": "local_head",
        "queried_at": queried_at,
    }
    try:
        commit = await asyncio.to_thread(read_latest_local_commit, repo)
    except (OSError, ValueError, subprocess.SubprocessError):
        gate = {
            "decision": "insufficient_evidence",
            "evidence_count": 0,
            "reason": "local_git_unavailable",
        }
        return {
            "question": question.strip(),
            ("answer"): (
                "无法读取当前仓库的本地 Git 提交记录，请先同步仓库或检查本"
                "地 checkout。最近提交时间需以 Git 记录为准。"
            ),
            "sources": [],
            "retrieval_count": 0,
            "generation_mode": "no_evidence",
            "model": None,
            "answer_gate": gate,
            "retrieval_config": {**config, "answer_gate": gate},
            "took_ms": round((time.perf_counter() - started) * 1000),
        }

    local_time = datetime.fromisoformat(commit["committed_at"]).astimezone(
        timezone(timedelta(hours=8))
    )
    # Values originate in repository content, so keep their
    # presentation on one line.
    subject = " ".join(commit["subject"].split())
    author = " ".join(commit["author"].split())
    snippet = (
        f"Repository: {repo.full_name}\nBranch: {commit['branch']}\nCommit: "
        f"{commit['sha']}\nCommitted at: {commit['committed_at']}\nAuthored at"
        f": {commit['authored_at']}\nAuthor: {author}\nSubject: {subject}"
    )
    source = {
        "citation": 1,
        "document_id": f"git:{repo.id}:{commit['sha']}",
        "source_id": commit["sha"],
        "source_type": "git_commit",
        ("title"): (
            f"{repo.full_name} · {commit['branch']} · {commit['sha'][:12]}"
        ),
        "snippet": snippet,
        "score": 1.0,
        "metadata": {
            **commit,
            "repo_id": str(repo.id),
            "scope": "local_head",
            "queried_at": queried_at,
        },
        "retrieval": {
            "backend": "git",
            "selected_for_context": True,
            "answer_gate": "answer",
        },
    }
    gate = {
        "decision": "answer",
        "evidence_count": 1,
        "reason": "current_local_git_head",
    }
    return {
        "question": question.strip(),
        "answer": (
            f"当前仓库 **{repo.full_name}** 本地分支 `{commit['branch']}` 的最"
            f"近一次提交时间是 **{local_time:%Y-%m-%d %H:%M:%S}（北京时间，UTC"
            f"+08:00）**。[1]\n\n- 提交：`{commit['sha'][:12]}`\n- 作者："
            f"{author}\n- 提交说明：{subject}\n\n以上读取自本地 checkout 的 "
            f"HEAD，未联网检查远端是否有更新。"
        ),
        "sources": [source],
        "retrieval_count": 1,
        "generation_mode": "direct",
        "model": None,
        "answer_gate": gate,
        "retrieval_config": {**config, "answer_gate": gate},
        "took_ms": round((time.perf_counter() - started) * 1000),
    }
