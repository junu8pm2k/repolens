# 团队仓库资源同步功能规格

状态：V1.0 评审稿。产品需求见 [PRD](PRD.md)，系统边界和技术取舍见 [ARCHITECTURE](ARCHITECTURE.md) 与 [ADR](ADR.md)，版本排期见 [ROADMAP](ROADMAP.md)。

## 命令接口

入口为 `scripts/sync_team_resources.py`，参数同时指定团队源仓库和本地目标项目。默认显示预览，收到确认后应用。`--preview` 返回计划后退出，保持目标文件、同步状态和项目索引原样。

```powershell
.\backend\.venv\Scripts\python.exe scripts/sync_team_resources.py --source 'C:\dev\team-resources' --target 'C:\dev\project' --preview
```

| 参数 | 约定 |
| --- | --- |
| `--source` | 必填，已拉取的团队 Git 仓库。预览开始时解析其 `HEAD` 提交。 |
| `--target` | 必填，目标 Git 项目根目录。源和目标解析后的根目录必须不同。 |
| `--preview` | 仅检查来源和目标、输出变更计划。 |
| `--docs-dir` | 对应 `sharing.docs.localDir`，默认 `docs/team-shared/`。值为目标项目 `docs/` 内的相对目录。 |
| `--api-base-url` | 本机 RepoLens 服务地址，默认 `http://localhost:8000`。用于文件交付后的文档索引。 [本地启动说明](../../README.md) |

预览至少展示完整 `source_commit`、目标项目、资源类型、源相对路径、目标相对路径，以及新增、更新、移除、冲突或待支持的原因。结果摘要包含各类别计数、文件交付状态和索引状态。默认交互模式确认的是同一次预览中的提交。非交互环境可使用 `--preview` 检查计划，应用需要交互确认。

| 退出码 | 结果 |
| --- | --- |
| `0` | 预览完成、成员取消、无变化，或本次交付全部完成。 |
| `2` | 参数、路径、Git 快照或首版资源格式无效。 |
| `3` | 目标冲突、预览已过时，或待恢复文件需要成员处理。 |
| `4` | 文件应用或本地状态写入失败。 |
| `5` | 文件阶段完成，文档索引尚未就绪。同一命令可重试索引。 |

## 快照读取与资源投递

通过 Git tree 枚举固定 SHA 下的资源，通过对象 ID 读取正文。预览和应用均使用该 SHA。源工作区未提交的内容与预览后的新提交留待下一次同步。Git 对象读取失败、约定目录被符号链接替代或存在路径冲突时停止应用，避免把未读取的资源当成已移除资源。

| 类型 | 首版输入 | 目标与处理 |
| --- | --- | --- |
| `skills` | `skills/<name>/SKILL.md` 和同目录 `references/` 下的 `.md`、`.txt`。`SKILL.md` 含与目录名一致的 `name`、非空 `description` 和正文。 | `skills/` 映射到项目 `.agents/skills/`，保留 Skill 目录和附件相对路径。先校验整包，再按文件应用。 |
| `rules` | `rules/<name>.md`，可以带 YAML frontmatter。 | 按源路径排序，正文进入根 `AGENTS.md` 管理区块的规则小节。frontmatter 中出现 `paths` 时列为待支持。若旧版是已交付的项目规则，预览另列旧版本撤下。 |
| 共享指令 | `agentsmd/*.md` | 按源路径排序，正文进入同一管理区块的共享指令小节。 |
| `docs` | `docs/` 下的 Markdown，支持子目录。 | 保留 `docs/` 以下的层级写入镜像。例如 `docs/api/migration.md` 写入 `docs/team-shared/api/migration.md`。索引记录前者作为来源。 |

仅交付 UTF-8 文本和普通文件。Skill 引用的参考资料必须存在且位于该 Skill 的 `references/` 内。缺少必需元数据、引用越界、编码异常或正文包含保留区块标记时，报告具体资源并阻止本次应用。合法的待支持项单独提示，其余有效变更仍可应用。

在源路径解析、计划生成及写入前检查路径边界。目标路径须位于目标项目根内，避免经过符号链接或目录联接。Windows 下检查大小写冲突、保留名称和文件与目录重名。

## 本地状态和应用规则

### `AGENTS.md` 管理区块

使用独占一行的 `<!-- BEGIN REPOLENS TEAM RESOURCES -->` 与 `<!-- END REPOLENS TEAM RESOURCES -->` 标记。首次应用追加一个区块，后续更新或撤下只作用于该区块。保留区块外内容及原有换行风格。首次追加为区块引入的分隔换行计入受管理范围。已登记的标记缺失、标记重复或交错、以及存在与清单不符的标记时，按冲突处理。目标原有的 `AGENTS.md` 内容由成员继续维护。

### 清单与变更判定

目标项目在 `.repolens/team-resource-sync/manifest.json` 保存 `schema_version`、规范化的源仓库根目录、最近一次应用的提交、文档镜像目录、预期文档摘要 `team_docs_digest`、文件阶段事务 ID 和受管理项。每项记录目标相对路径、资源类型、源路径及最后写入的 SHA-256。`AGENTS.md` 记录区块摘要和对应的多个源路径。文档条目还记录该内容版本的来源提交。源路径和内容相同的文档沿用原来源提交。

同步工具在状态目录内生成 Git 忽略规则，将清单和恢复备份留在本机。

| 情况 | 计划项 |
| --- | --- |
| 预期有文件，目标位置为空且清单无记录 | 新增。 |
| 预期内容变化，目标仍匹配清单 | 更新。 |
| 完整快照确认资源撤下，目标仍匹配清单 | 移除该受管理文件或区块内条目。 |
| 本地同名内容未登记、受管理项被修改或删除、清单中的源仓库与本次输入不同 | 冲突，等待成员处理。 |
| 预期内容和当前受管理产物相同 | 无文件变更。 |

同一次计划出现冲突时，整批文件应用暂停。计划不依赖目标文件的修改时间判定归属。重跑已完整交付的同一提交时，无文件、清单或索引的重复写入。

### 写入与恢复

1. 成员确认后取得目标项目排他锁，重新核对预览记录的目标摘要。目标发生变化时退出，提示重新预览。
2. 在同一文件系统暂存新内容和恢复数据。恢复清单记录写入前、写入后摘要及备份位置。逐个更新文件，再原子替换正式清单，作为文件阶段提交点。
3. 检测到待恢复写入时，先显示受影响的文件。成员确认后核对并恢复，再重新生成预览。目标仍匹配本次写入后的内容时，可以恢复备份或清理本次新增文件。文件又被手动修改时显示恢复冲突。事务已经提交时，清理残留的临时数据。单独运行 `--preview` 时只报告待恢复状态。
4. 文件阶段提交后释放锁，再进入索引阶段。索引失败保留已完成的文件交付，命令显示索引待重试和失败原因。

## 文档索引接口

CLI 将目标根目录与 `GET /api/repos` 返回的 `local_path` 规范化比对，选出唯一 `repo_id`。目标项目需要与本机 RepoLens 后端共享同一工作区。无法绑定时，返回文件阶段结果并将索引标记为待重试。 [仓库接口](../../backend/app/api/routes/repos.py)

- 预期文档摘要由每项镜像路径、源相对路径、内容摘要和来源提交按路径排序后计算。更新内容、移动镜像位置或撤下文档都会改变摘要。无关提交沿用已有文档摘要。
- 从未交付过团队文档且当前提交没有文档时，摘要留空，索引状态为「无需刷新」。移除最后一份文档时，记录空清单的摘要并完成索引，以清除旧内容。
- 复用 `POST /api/repos/{repo_id}/memory-index/scan` 发起索引，复用 `GET /api/repos/{repo_id}/memory-index/state` 查询结果。扫描返回 `202` 表示任务已受理。只有状态为 `ready` 且 `summary_json.team_docs_digest` 等于预期摘要，才报告本次文档索引就绪。过期的成功状态、等待超时、项目路径不匹配与索引失败都需要显示明确原因。
- 索引阶段只发布完整的团队文档快照。匹配镜像路径和内容摘要后，将 `team_source_path` 与 `team_source_commit` 同正文写入元数据。被项目索引配置排除、扫描截断或读取失败的受管理文档出现在失败明细里。索引提交前复核团队文档摘要，避免提交过期扫描。
- 同一提交重新运行时，若文件阶段已完成且文档摘要仍待确认，只需补做索引。索引就绪后，更新的文档只返回当前内容，已撤下的文档退出团队检索。 [项目索引路由](../../backend/app/api/routes/project_index.py) · [索引实现](../../backend/app/services/project_indexing.py)

## Codex `recall` 接口

在既有本地 RepoLens MCP 服务增加一个只读工具 `recall`。该服务在试点时与目标项目绑定。`repo_id` 与绑定不符时拒绝查询，避免跨项目召回。

| 入参 | 约定 |
| --- | --- |
| `repo_id` | 必填，已绑定的项目 UUID。 |
| `query` | 必填，去除首尾空白后仍有内容的查询文本。 |
| `limit` | 可选，整数 `1` 至 `20`，默认 `5`。 |

检索先依据项目和团队文档元数据过滤，再排序与截取。每条结果含 `title`、`snippet`、`source_path`、`source_commit`。`source_path` 来自索引快照里的团队仓库相对路径。无匹配时返回空 `results`。索引待重试期间可查询上一次成功提交的快照，结果中的 `source_commit` 与返回内容对应。

```json
{
  "results": [
    {
      "title": "接口迁移说明",
      "snippet": "客户端切换后仍需兼容上一版接口。",
      "source_path": "docs/api/migration.md",
      "source_commit": "<团队仓库提交 SHA>"
    }
  ]
}
```

复用现有 MCP 文本传输，在 `content` 的 `text` 中返回上述 JSON 对象。参数错误沿用现有 JSON-RPC 错误码 `-32602`，消息区分无效参数和目标项目不匹配。现有通用证据工具继续使用自身的输出契约。 [检索结果](../../backend/app/services/chat_memory.py) · [MCP 工具入口](../../backend/app/mcp/memory_server.py)

### 本地接入

启动同机 RepoLens 后端并连接目标工作区。先带 `--preview` 运行命令，再去掉该参数并确认应用。索引完成后，命令会打印目标 RepoLens 项目 ID。

将以下示例合入目标项目的受信任 Codex 配置 `.codex/config.toml`。把路径和项目 ID 换成本机实际值，并让 MCP 进程使用与 RepoLens 后端相同的数据库配置。开启新的 Codex CLI 会话后可调用 `recall`。 [Codex 本地 MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli#configure-with-configtoml)

```toml
[mcp_servers.repolens_recall]
command = 'C:\dev\RepoLens AI\backend\.venv\Scripts\python.exe'
args = ['app/mcp/memory_server.py']
cwd = 'C:\dev\RepoLens AI\backend'
env = { REPOLENS_RECALL_REPO_ID = '<同步命令打印的项目 UUID>' }
enabled_tools = ['recall']
```

## 验收用例

| 场景 | 可验证结果 |
| --- | --- |
| 预览与固定提交 | 预览不写目标。确认前源 `HEAD` 前进，应用仍使用预览的 SHA 和资源内容。 |
| 首次使用四类资源 | 新 Codex CLI 会话能调用 Skill、读取规则和指令，并通过 `recall` 取得团队文档片段和原始路径。 |
| 覆盖保护与重复运行 | 本地同名、托管内容被改、预览后发生修改均报冲突。成功后重复运行无额外写入。 |
| 规则范围变更 | 将已应用的项目级 Rule 改成带 `paths:` 的版本，预览同时显示旧版撤下和新版待支持，应用后新版不会作为项目级约束加载。 |
| 文件中断恢复 | 在替换文件后、提交清单前模拟中断，重试可恢复已知写入。期间用户改动触发恢复冲突。 |
| 索引失败与溯源 | 显示文件已交付、索引待重试。重试后 `recall` 返回新内容与正确提交，撤下文档退出检索。索引排除和跨项目查询有明确反馈。 |
