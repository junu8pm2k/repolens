import hashlib
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

STATE_DIR = PurePosixPath(".repolens/team-resource-sync")
MANIFEST_PATH = STATE_DIR / "manifest.json"
JOURNAL_PATH = STATE_DIR / "pending.json"
DEFAULT_DOCS_DIR = "docs/team-shared"
GUIDANCE_PATH = "AGENTS.md"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or path.as_posix() != value:
        raise ValueError(f"无效相对路径：{value}")
    for part in path.parts:
        if (
            part.casefold() in {"..", ".git"}
            or part.endswith((".", " "))
            or PureWindowsPath(part).is_reserved()
            or any(ord(char) < 32 or char in '<>:"\\|?*' for char in part)
        ):
            raise ValueError(f"不安全的路径：{value}")
    return path


def docs_dir(value: str) -> PurePosixPath:
    path = relative_path(value.rstrip("/"))
    if len(path.parts) < 2 or path.parts[0] != "docs":
        raise ValueError("文档镜像目录必须位于目标项目的 docs/ 下")
    return path


def target_path(root: Path, value: str) -> Path:
    current = root
    parts = relative_path(value).parts
    for position, part in enumerate(parts):
        current /= part
        if current.is_symlink() or current.is_junction():
            raise ValueError(f"目标路径含符号链接或目录联接：{value}")
        if position < len(parts) - 1 and current.exists():
            if not current.is_dir():
                raise ValueError(f"目标路径的父级不是目录：{value}")
    return current


def read_file(root: Path, value: str) -> bytes | None:
    path = target_path(root, value)
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError(f"目标位置不是普通文件：{value}")
    return path.read_bytes()


class ManagedFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["skill", "guidance", "doc"]
    sources: tuple[str, ...] = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_commit: str | None = Field(
        default=None, pattern=r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
    )
    separator: Literal[0, 1, 2] = 0


def document_digest(files: dict[str, ManagedFile]) -> str:
    values = [
        [path, item.sources[0], item.sha256, item.source_commit]
        for path, item in sorted(files.items())
        if item.kind == "doc"
    ]
    return sha256(json.dumps(values, separators=(",", ":")).encode())


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    source_root: str
    applied_commit: str = Field(pattern=r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
    docs_dir: str
    transaction_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    team_docs_digest: str | None = None
    files: dict[str, ManagedFile]

    @model_validator(mode="after")
    def check_paths(self) -> "Manifest":
        mirror = docs_dir(self.docs_dir)
        seen: set[str] = set()
        for name, item in self.files.items():
            target = relative_path(name)
            sources = tuple(relative_path(source) for source in item.sources)
            if name.casefold() in seen:
                raise ValueError(f"清单目标路径重复：{name}")
            seen.add(name.casefold())
            if item.kind == "guidance":
                valid = name == GUIDANCE_PATH and all(
                    len(source.parts) == 2
                    and source.parts[0] in {"rules", "agentsmd"}
                    and source.suffix == ".md"
                    for source in sources
                )
            elif item.kind == "skill":
                valid = (
                    len(sources) == 1
                    and sources[0].parts[0] == "skills"
                    and len(sources[0].parts) >= 3
                    and target == PurePosixPath(".agents") / sources[0]
                    and (
                        sources[0].parts[2:] == ("SKILL.md",)
                        or (
                            len(sources[0].parts) >= 4
                            and sources[0].parts[2] == "references"
                            and sources[0].suffix in {".md", ".txt"}
                        )
                    )
                )
            else:
                valid = (
                    len(sources) == 1
                    and sources[0].is_relative_to("docs")
                    and sources[0].suffix == ".md"
                    and target == mirror / sources[0].relative_to("docs")
                    and item.source_commit is not None
                )
            if not valid:
                raise ValueError(f"清单包含无效的托管目标：{name}")
        has_docs = any(item.kind == "doc" for item in self.files.values())
        if (has_docs or self.team_docs_digest is not None) and (
            document_digest(self.files) != self.team_docs_digest
        ):
            raise ValueError("清单中的团队文档摘要无效")
        return self


def load_manifest(root: Path) -> Manifest | None:
    raw = read_file(root, MANIFEST_PATH.as_posix())
    return Manifest.model_validate_json(raw) if raw is not None else None
