# RepoLens AI 仓库约定

本文件适用于整个仓库。

## Python 代码规范

Python 代码遵循 [PEP 8](https://peps.python.org/pep-0008/)，适用于 `backend/app` 和 `scripts` 中的源码及测试。

- 每级缩进使用 4 个空格，不混用 Tab；文件使用 UTF-8、LF 换行并保留末尾换行。
- 代码行宽为 79 字符；注释和文档字符串尽量控制在 72 字符。
- 长表达式使用括号隐式续行，多行参数、容器元素按层级缩进，避免密集的单行语句。
- 标准库、第三方库、项目内导入分组，组间空一行；优先使用绝对导入，不使用通配符导入。
- 顶层类和函数之间空两行，类内方法之间空一行；运算符、逗号和注释周围空格保持一致。
- 类名使用 `PascalCase`，函数、变量及模块名使用 `snake_case`，常量使用 `UPPER_SNAKE_CASE`；避免 `l`、`O`、`I` 等易混淆的单字母变量名。
- 使用 `is None` / `is not None` 判断空值；不要为满足风格规范改变接口、业务行为或兼容性。
- 提示词、正则、SQL、URL 和测试样本属于数据。整理时保持其值不变，不为缩短源代码行而修改运行时文本。
- 仅在有明确技术原因时使用局部规则例外，写清原因；不通过全局忽略或大批量 `noqa` 隐藏问题。

以根目录 `pyproject.toml` 为检查配置。开发依赖安装在项目虚拟环境中：

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
```

修改 Python 代码后，在仓库根目录执行：

```powershell
.\backend\.venv\Scripts\python.exe -m ruff check backend/app scripts
.\backend\.venv\Scripts\python.exe -m ruff format --check --output-format concise backend/app scripts
```

自动整理使用 `ruff check --fix` 和 `ruff format`。格式修改后检查 diff，并运行对应回归测试；涉及全仓库整理时运行全部后端测试。CI 同样执行风格检查。

## Git 提交规范

### 提交消息

使用 Conventional Commits 格式 `type(scope): 中文摘要`，`scope` 可省略。类型和范围使用小写英文。用半角冒号 `:` 加一个空格分隔前缀和摘要。冒号后的摘要必须用中文简短说明实际改动，可保留 `CI`、`Langfuse` 等技术术语和专有名词。

- `feat` 新增功能，`fix` 修复问题，`docs` 更新文档，`refactor` 重构实现。
- `test` 调整测试，`ci` 调整持续集成，`build` 调整构建或依赖，`chore` 维护仓库。
- 范围使用实际模块，如 `web`、`eval` 或 `deps`。例如 `fix(eval): 记录 Judge 输出截断原因`。
- 需要补充背景或验证结果时，在标题后空一行写正文。可用 `Refs #123` 关联 Issue，用 `Closes #123` 标明合并后应关闭的 Issue。破坏性变更用 `!` 和 `BREAKING CHANGE:` 说明影响与迁移方式。

### 提交与合并

- 每条提交聚焦一项可独立审查的改动，将实现、对应测试和文档放在一起。合并前可整理同一改动的临时提交和反复修订。
- 提交前用 `git status`、`git diff --cached` 和 `git diff --cached --check` 核对暂存内容，并运行与改动相关的检查。排除密钥、`.env` 和本地生成产物。
- 从 `main` 建立 `<agent>/<简短主题>` 分支（前缀与当前使用的 agent 保持一致不要大写，如 `antigravity/<简短主题>`、`codex/<简短主题>`、`claude/<简短主题>` 、`dsh/<简短主题>`等），在 PR 中记录改动和验证结果。合并后清理已完成的分支，使用 `git fetch --prune origin` 同步本地远端跟踪引用。
- 重写已推送的历史前先确认影响范围、核对远端最新提交并备份旧引用。需要强制推送时，为每个分支使用带预期旧 SHA 的 `--force-with-lease`。删除分支前确认 PR 状态和独有提交的去向。
