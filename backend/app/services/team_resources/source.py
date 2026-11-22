import re
import subprocess
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

import yaml

from app.services.team_resources.manifest import relative_path

BEGIN_GUIDANCE = b"<!-- BEGIN REPOLENS TEAM RESOURCES -->"
END_GUIDANCE = b"<!-- END REPOLENS TEAM RESOURCES -->"
MAX_TEXT_BYTES = 400_000
SOURCE_DIRS = ("skills", "rules", "agentsmd", "docs")


@dataclass(frozen=True)
class Snapshot:
    commit: str
    skills: dict[str, bytes]
    rules: dict[str, bytes]
    instructions: dict[str, bytes]
    documents: dict[str, bytes]
    unsupported: dict[str, str]


def _git(root: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(
            ["git", "--no-replace-objects", "-C", str(root), *args],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError(f"无法在 {root} 读取 Git 快照（{args[0]}）") from exc
    return result.stdout


def git_root(root: Path) -> Path:
    selected = root.resolve()
    if not selected.is_dir():
        raise ValueError(f"Git 工作区目录不存在：{root}")
    git_path = _git(selected, "rev-parse", "--show-toplevel")
    expected = Path(git_path.decode("utf-8").strip()).resolve()
    if expected != selected:
        raise ValueError(f"请选择 Git 工作区根目录：{expected}")
    return selected


def _split_metadata(text: str, name: str) -> tuple[dict, str]:
    lines = text.splitlines(keepends=True)
    if lines[0].strip() != "---":
        return {}, text
    for position, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            try:
                data = yaml.safe_load("".join(lines[1:position]))
            except yaml.YAMLError as exc:
                raise ValueError(f"无效的 YAML 元数据：{name}") from exc
            if data is not None and not isinstance(data, dict):
                raise ValueError(f"资源元数据必须是对象：{name}")
            return data or {}, "".join(lines[position + 1 :])
    raise ValueError(f"资源元数据缺少结束标记：{name}")


def _read_text(root: Path, object_id: str, size: str, name: str) -> bytes:
    if int(size) > MAX_TEXT_BYTES:
        raise ValueError(f"资源大于 {MAX_TEXT_BYTES} 字节：{name}")
    data = _git(root, "cat-file", "blob", object_id)
    try:
        decoded = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"资源必须是 UTF-8 文本：{name}") from exc
    if not decoded.strip() or "\0" in decoded:
        raise ValueError(f"资源必须是非空文本：{name}")
    if BEGIN_GUIDANCE in data or END_GUIDANCE in data:
        raise ValueError(f"资源正文包含保留的管理区块标记：{name}")
    return data


def _check_case(path: PurePosixPath, paths: dict[str, str]) -> None:
    for part in (*path.parents, path):
        name = part.as_posix()
        old = paths.setdefault(name.casefold(), name)
        if old != name:
            raise ValueError(f"路径大小写冲突：{old} 与 {name}")


def _check_skills(skills: dict[str, bytes]) -> None:
    folders = {relative_path(name).parts[1] for name in skills}
    for folder in sorted(folders):
        root = PurePosixPath("skills", folder)
        name = (root / "SKILL.md").as_posix()
        if name not in skills:
            raise ValueError(f"Skill 附件缺少入口：{name}")
        fields, body = _split_metadata(skills[name].decode(), name)
        description = fields.get("description")
        if (
            fields.get("name") != folder
            or re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", folder) is None
            or len(folder) > 64
            or not isinstance(description, str)
            or not description.strip()
            or not body.strip()
        ):
            raise ValueError(
                f"Skill 需要有效的 name、description 和正文：{name}"
            )
        links = re.findall(r"\]\(\s*(?:<([^>]+)>|([^\s)]+))", body)
        references = [angle or normal for angle, normal in links]
        references.extend(re.findall(r"`(references/[^`]+)`", body))
        for reference in references:
            url = urlsplit(reference)
            if url.scheme or url.netloc or not url.path:
                continue
            path = relative_path(unquote(url.path))
            if (
                not path.is_relative_to("references")
                or (root / path).as_posix() not in skills
            ):
                raise ValueError(f"{name} 引用了无效参考资料：{reference}")


def load_snapshot(root: Path) -> Snapshot:
    commit = (
        _git(root, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    )
    records = _git(root, "ls-tree", "-rlz", commit, "--", *SOURCE_DIRS)
    skills: dict[str, bytes] = {}
    rules: dict[str, bytes] = {}
    instructions: dict[str, bytes] = {}
    documents: dict[str, bytes] = {}
    unsupported: dict[str, str] = {}
    paths: dict[str, str] = {}
    for record in filter(None, records.split(b"\0")):
        metadata, raw_name = record.split(b"\t", 1)
        mode, kind, object_id, size = metadata.decode("ascii").split()
        name = raw_name.decode("utf-8")
        path = relative_path(name)
        _check_case(path, paths)
        category, *parts = path.parts
        if not parts or kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError(f"来源必须是普通 Git 文件：{name}")
        if category == "skills":
            if len(parts) == 1 and path.suffix == ".md":
                unsupported[name] = "单文件 Skill 留待 V2.0"
            elif parts[1:] == ["SKILL.md"] or (
                len(parts) >= 3
                and parts[1] == "references"
                and path.suffix in {".md", ".txt"}
            ):
                skills[name] = _read_text(root, object_id, size, name)
        elif category in {"rules", "agentsmd"} and path.suffix == ".md":
            if len(parts) != 1:
                unsupported[name] = "首版仅支持该目录下的单层 Markdown"
                continue
            data = _read_text(root, object_id, size, name)
            fields, body = _split_metadata(data.decode(), name)
            if category == "rules" and "paths" in fields:
                unsupported[name] = "带 paths 的规则留待 V2.0"
            elif not body.strip():
                raise ValueError(f"资源缺少正文：{name}")
            elif category == "rules":
                rules[name] = body.encode()
            else:
                instructions[name] = body.encode()
        elif category == "docs" and path.suffix == ".md":
            documents[name] = _read_text(root, object_id, size, name)
    _check_skills(skills)
    return Snapshot(
        commit, skills, rules, instructions, documents, unsupported
    )
