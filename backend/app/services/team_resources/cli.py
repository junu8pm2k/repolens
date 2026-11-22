import argparse
import sys
from collections import Counter
from pathlib import Path

import httpx

from app.services.team_resources.apply import (
    apply_plan,
    pending_journal,
    recover,
)
from app.services.team_resources.index_client import (
    ensure_index,
    local_api_url,
)
from app.services.team_resources.manifest import DEFAULT_DOCS_DIR, docs_dir
from app.services.team_resources.plan import Plan, SyncConflict, build_plan
from app.services.team_resources.source import git_root, load_snapshot


def _confirm(message: str) -> bool:
    if not sys.stdin.isatty():
        raise ValueError("应用需要交互确认。非交互环境请使用 --preview")
    try:
        return input(f"{message} [y/N] ").strip().casefold() in {"y", "yes"}
    except EOFError:
        return False


def _show_plan(plan: Plan, target: Path, unsupported: dict[str, str]) -> None:
    print(f"来源提交 {plan.manifest.applied_commit}\n目标项目 {target}")
    counts: Counter[str] = Counter()
    previous = plan.previous.files if plan.previous else {}
    for change in plan.changes:
        new = plan.manifest.files.get(change.path)
        old = previous.get(change.path)
        action = "更新" if old and new else "新增" if new else "移除"
        item = new or old
        if item is None:
            continue
        counts[action] += 1
        sources = ", ".join(item.sources)
        print(f"{action} [{item.kind}] {sources} -> {change.path}")
        if old and new:
            for name in sorted(set(old.sources) - set(new.sources)):
                print(f"  撤下 {name}")
    for path, reason in sorted(plan.conflicts.items()):
        print(f"冲突 {path}: {reason}")
    for path, reason in sorted(unsupported.items()):
        print(f"待支持 {path}: {reason}")
    print(
        f"新增 {counts['新增']}，更新 {counts['更新']}，"
        f"移除 {counts['移除']}，"
        f"冲突 {len(plan.conflicts)}，待支持 {len(unsupported)}"
    )


def _run(args: argparse.Namespace) -> int:
    source = git_root(args.source)
    target = git_root(args.target)
    if source == target:
        raise ValueError("团队源和目标项目必须是不同的 Git 工作区")
    mirror = docs_dir(args.docs_dir)
    api_url = local_api_url(args.api_base_url)
    pending = pending_journal(target)
    if pending is not None:
        paths = ", ".join(item.path for item in pending.changes)
        print(f"待恢复文件：{paths}")
        if args.preview or not _confirm("是否恢复上次中断的同步？"):
            return 3
        try:
            recover(target, pending)
        except OSError as exc:
            print(f"文件恢复失败：{exc}", file=sys.stderr)
            return 4
    snapshot = load_snapshot(source)
    plan = build_plan(source, target, snapshot, mirror)
    _show_plan(plan, target, snapshot.unsupported)
    if plan.conflicts:
        return 3
    if args.preview:
        return 0
    if plan.needs_write and not _confirm("是否应用已预览的变更？"):
        print("已取消")
        return 0
    try:
        manifest = apply_plan(target, plan)
    except OSError as exc:
        print(f"文件应用失败：{exc}", file=sys.stderr)
        return 4
    print("文件已同步" if plan.changes else "文件无变化")
    if manifest.team_docs_digest is None:
        print("文档索引无需刷新")
        return 0
    try:
        with httpx.Client(
            base_url=api_url, timeout=3, trust_env=False
        ) as client:
            ensure_index(client, target, manifest.team_docs_digest)
    except (httpx.HTTPError, ValueError) as exc:
        print(f"文件已同步，文档索引待重试：{exc}", file=sys.stderr)
        return 5
    print("文档索引已就绪")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="同步团队仓库资源到本地项目")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--docs-dir", default=DEFAULT_DOCS_DIR)
    parser.add_argument("--api-base-url", default="http://localhost:8000")
    parser.add_argument("--preview", action="store_true")
    try:
        return _run(parser.parse_args(argv))
    except SyncConflict as exc:
        print(f"同步冲突：{exc}", file=sys.stderr)
        return 3
    except (OSError, ValueError) as exc:
        print(f"同步输入无效：{exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("已中断。重新运行命令可检查状态。", file=sys.stderr)
        return 4
