import base64
import binascii
import os
import stat
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

from pydantic import BaseModel, ConfigDict, Field

from app.services.team_resources.manifest import (
    JOURNAL_PATH,
    MANIFEST_PATH,
    STATE_DIR,
    Manifest,
    read_file,
    sha256,
    target_path,
)
from app.services.team_resources.plan import Plan, SyncConflict


class RecoveryFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    before: str | None
    after_sha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")

    def before_bytes(self) -> bytes | None:
        if self.before is None:
            return None
        return base64.b64decode(self.before, validate=True)


class Journal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    previous_sha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")
    manifest: Manifest
    changes: list[RecoveryFile]


def _digest(data: bytes | None) -> str | None:
    return sha256(data) if data is not None else None


def _lock_file(handle: BinaryIO, lock: bool) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        mode = msvcrt.LK_NBLCK if lock else msvcrt.LK_UNLCK
        msvcrt.locking(handle.fileno(), mode, 1)
    else:
        import fcntl

        mode = fcntl.LOCK_EX | fcntl.LOCK_NB if lock else fcntl.LOCK_UN
        fcntl.flock(handle, mode)


@contextmanager
def _project_lock(root: Path) -> Iterator[None]:
    path = target_path(root, (STATE_DIR / "sync.lock").as_posix())
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        try:
            _lock_file(handle, True)
        except OSError as exc:
            raise SyncConflict("目标项目已有同步操作在运行") from exc
        try:
            yield
        finally:
            _lock_file(handle, False)


def _write(root: Path, name: str, data: bytes | None) -> None:
    path = target_path(root, name)
    if data is None:
        path.unlink()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = (
        stat.S_IMODE(path.stat().st_mode)
        if os.name != "nt" and path.exists()
        else None
    )
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            stream.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        if mode is not None:
            temporary.chmod(mode)
        temporary.replace(target_path(root, name))
    finally:
        temporary.unlink(missing_ok=True)


def pending_journal(root: Path) -> Journal | None:
    try:
        raw = read_file(root, JOURNAL_PATH.as_posix())
        return Journal.model_validate_json(raw) if raw is not None else None
    except (OSError, ValueError) as exc:
        raise SyncConflict("无法读取目标项目的同步恢复记录") from exc


def recover(root: Path, expected: Journal) -> None:
    with _project_lock(root):
        if pending_journal(root) != expected:
            raise SyncConflict("恢复记录发生变化，请重新预览")
        raw = read_file(root, MANIFEST_PATH.as_posix())
        old = Manifest.model_validate_json(raw) if raw is not None else None
        if old != expected.manifest:
            if _digest(raw) != expected.previous_sha256:
                raise SyncConflict("本地同步清单变化，无法自动恢复")
            allowed = expected.manifest.files.keys() | (
                old.files.keys() if old is not None else set()
            )
            restores: dict[str, bytes | None] = {}
            for change in expected.changes:
                if change.path not in allowed:
                    raise SyncConflict("恢复记录包含未登记的目标文件")
                try:
                    original = change.before_bytes()
                except binascii.Error as exc:
                    raise SyncConflict("恢复记录中的备份无效") from exc
                current = read_file(root, change.path)
                if current == original:
                    continue
                if _digest(current) != change.after_sha256:
                    raise SyncConflict(f"恢复期间发现本地修改：{change.path}")
                restores[change.path] = original
            for path, original in restores.items():
                _write(root, path, original)
        _write(root, JOURNAL_PATH.as_posix(), None)


def apply_plan(root: Path, plan: Plan) -> Manifest:
    if plan.conflicts:
        raise SyncConflict("目标存在冲突，未应用变更")
    if not plan.needs_write:
        return plan.manifest
    with _project_lock(root):
        if pending_journal(root) is not None:
            raise SyncConflict("目标项目有待恢复的同步操作")
        if read_file(root, MANIFEST_PATH.as_posix()) != plan.before or any(
            _digest(read_file(root, path)) != expected
            for path, expected in plan.observed.items()
        ):
            raise SyncConflict("目标文件在预览后发生变化，请重新预览")
        manifest = plan.manifest.model_copy(
            update={"transaction_id": uuid.uuid4().hex}
        )
        if plan.changes:
            journal = Journal(
                previous_sha256=_digest(plan.before),
                manifest=manifest,
                changes=[
                    RecoveryFile(
                        path=change.path,
                        before=(
                            base64.b64encode(change.before).decode("ascii")
                            if change.before is not None
                            else None
                        ),
                        after_sha256=_digest(change.after),
                    )
                    for change in plan.changes
                ],
            )
            _write(
                root,
                JOURNAL_PATH.as_posix(),
                journal.model_dump_json().encode(),
            )
            for change in plan.changes:
                if read_file(root, change.path) != change.before:
                    raise SyncConflict(f"目标在应用期间被修改：{change.path}")
                _write(root, change.path, change.after)
        _write(
            root, MANIFEST_PATH.as_posix(), manifest.model_dump_json().encode()
        )
        if plan.changes:
            _write(root, JOURNAL_PATH.as_posix(), None)
    return manifest
