from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from app.services.team_resources.manifest import (
    GUIDANCE_PATH,
    MANIFEST_PATH,
    ManagedFile,
    Manifest,
    document_digest,
    read_file,
    sha256,
)
from app.services.team_resources.source import (
    BEGIN_GUIDANCE,
    END_GUIDANCE,
    Snapshot,
)


class SyncConflict(ValueError):
    pass


@dataclass(frozen=True)
class Change:
    path: str
    before: bytes | None
    after: bytes | None


@dataclass
class Plan:
    before: bytes | None
    previous: Manifest | None
    manifest: Manifest
    changes: list[Change]
    observed: dict[str, str | None]
    conflicts: dict[str, str]

    @property
    def needs_write(self) -> bool:
        return bool(self.changes or self.manifest != self.previous)


def _read_target(target: Path, path: str) -> bytes | None:
    try:
        return read_file(target, path)
    except (OSError, ValueError) as exc:
        raise SyncConflict(str(exc)) from exc


def _managed_block(
    current: bytes, old: ManagedFile | None
) -> tuple[int, int] | None:
    beginnings: list[int] = []
    endings: list[int] = []
    offset = 0
    for line in current.splitlines(keepends=True):
        marker = line.rstrip(b"\r\n")
        if marker == BEGIN_GUIDANCE:
            beginnings.append(offset)
        if marker == END_GUIDANCE:
            endings.append(offset + len(line))
        offset += len(line)
    if old is None:
        if beginnings or endings:
            raise SyncConflict("AGENTS.md 中已有未登记的团队管理区块")
        return None
    if len(beginnings) != 1 or len(endings) != 1:
        raise SyncConflict("AGENTS.md 的团队管理区块标记缺失或重复")
    start = beginnings[0] - old.separator
    end = endings[0]
    if start < 0 or start >= end or sha256(current[start:end]) != old.sha256:
        raise SyncConflict("AGENTS.md 的团队管理区块已被修改")
    return start, end


def _render_guidance(
    target: Path,
    snapshot: Snapshot,
    current: bytes | None,
    old: ManagedFile | None,
) -> tuple[bytes | None, ManagedFile | None]:
    data = current or b""
    block = _managed_block(data, old)
    sources = (*sorted(snapshot.rules), *sorted(snapshot.instructions))
    if not sources:
        if block is None:
            return current, None
        start, end = block
        return data[:start] + data[end:], None

    if _read_target(target, "AGENTS.override.md") is not None:
        raise SyncConflict("目标项目的 AGENTS.override.md 优先于 AGENTS.md")
    first_newline = data.find(b"\n")
    newline = b"\r\n" if data[: first_newline + 1].endswith(b"\r\n") else b"\n"
    if block is not None and old is not None:
        start, end = block
        padding = data[start : start + old.separator]
    else:
        start = end = len(data)
        padding = newline if data and not data.endswith(b"\n") else b""
    lines = [BEGIN_GUIDANCE]
    for heading, section in (
        (b"## Team rules", snapshot.rules),
        (b"## Team instructions", snapshot.instructions),
    ):
        if section:
            lines.extend((b"", heading))
            for name in sorted(section):
                body = newline.join(section[name].splitlines()).rstrip()
                lines.extend((b"", body))
    lines.extend((b"", END_GUIDANCE, b""))
    managed = padding + newline.join(lines)
    record = ManagedFile(
        kind="guidance",
        sources=sources,
        sha256=sha256(managed),
        separator=len(padding),
    )
    return data[:start] + managed + data[end:], record


def build_plan(
    source: Path, target: Path, snapshot: Snapshot, mirror: PurePosixPath
) -> Plan:
    before = _read_target(target, MANIFEST_PATH.as_posix())
    try:
        previous = Manifest.model_validate_json(before) if before else None
    except ValueError as exc:
        raise SyncConflict("目标项目的同步清单无效") from exc
    if previous is not None and Path(previous.source_root) != source:
        raise SyncConflict("目标项目已绑定到另一个团队仓库")
    old = previous.files if previous is not None else {}
    records: dict[str, ManagedFile] = {}
    payloads: dict[str, bytes] = {}
    for name, content in snapshot.skills.items():
        path = f".agents/{name}"
        payloads[path] = content
        records[path] = ManagedFile(
            kind="skill", sources=(name,), sha256=sha256(content)
        )
    for name, content in snapshot.documents.items():
        path = (mirror / PurePosixPath(name).relative_to("docs")).as_posix()
        checksum = sha256(content)
        existing = old.get(path)
        source_commit = snapshot.commit
        if (
            existing is not None
            and existing.sources == (name,)
            and existing.sha256 == checksum
        ):
            source_commit = existing.source_commit or source_commit
        payloads[path] = content
        records[path] = ManagedFile(
            kind="doc",
            sources=(name,),
            sha256=checksum,
            source_commit=source_commit,
        )

    changes: list[Change] = []
    observed: dict[str, str | None] = {}
    conflicts: dict[str, str] = {}
    keys = old.keys() | payloads.keys()
    if snapshot.rules or snapshot.instructions:
        keys.add(GUIDANCE_PATH)
    seen: dict[str, str] = {}
    for path in sorted(keys):
        for part in (*PurePosixPath(path).parents, PurePosixPath(path)):
            label = part.as_posix()
            prior = seen.setdefault(label.casefold(), label)
            if prior != label:
                conflicts[path] = f"目标路径大小写冲突：{prior} 与 {label}"
    for path in sorted(keys):
        try:
            current = _read_target(target, path)
            digest = sha256(current) if current is not None else None
            observed[path] = digest
            old_record = old.get(path)
            if path == GUIDANCE_PATH:
                desired, record = _render_guidance(
                    target, snapshot, current, old_record
                )
                if record is not None:
                    records[path] = record
            elif digest != (old_record.sha256 if old_record else None):
                raise SyncConflict("目标同名文件或托管内容已被本地修改")
            else:
                desired = payloads.get(path)
            if current != desired:
                changes.append(Change(path, current, desired))
        except SyncConflict as exc:
            conflicts[path] = str(exc)
    had_docs = previous is not None and previous.team_docs_digest is not None
    manifest = Manifest(
        source_root=str(source),
        applied_commit=snapshot.commit,
        docs_dir=mirror.as_posix(),
        transaction_id=(previous.transaction_id if previous else "0" * 32),
        team_docs_digest=(
            document_digest(records)
            if snapshot.documents or had_docs
            else None
        ),
        files=records,
    )
    return Plan(before, previous, manifest, changes, observed, conflicts)
