from dataclasses import dataclass
from pathlib import Path

from app.services.team_resources.manifest import (
    JOURNAL_PATH,
    STATE_DIR,
    ManagedFile,
    load_manifest,
    read_file,
    sha256,
    target_path,
)


@dataclass(frozen=True)
class TeamDocuments:
    digest: str
    files: dict[str, ManagedFile]

    def require_paths(self, candidates: set[str]) -> None:
        missing = self.files.keys() - candidates
        if missing:
            paths = ", ".join(sorted(missing))
            raise ValueError(f"团队文档被索引配置或扫描范围排除：{paths}")

    def read(self, root: Path, path: str) -> str:
        data = read_file(root, path)
        if data is None or sha256(data) != self.files[path].sha256:
            raise ValueError(f"镜像与同步清单不匹配，请重新同步：{path}")
        text = data.decode("utf-8-sig")
        if not text.strip():
            raise ValueError(f"团队文档缺少可索引内容：{path}")
        return text


def load_team_documents(root: Path) -> TeamDocuments | None:
    directory = root / STATE_DIR
    if not directory.exists() and not directory.is_symlink():
        return None
    if target_path(root, JOURNAL_PATH.as_posix()).exists():
        raise ValueError("团队资源仍在应用或待恢复，请完成同步后重试索引")
    manifest = load_manifest(root)
    if manifest is None or manifest.team_docs_digest is None:
        return None
    return TeamDocuments(
        manifest.team_docs_digest,
        {
            path: item
            for path, item in manifest.files.items()
            if item.kind == "doc"
        },
    )
