# Security

- API Key 和 GitHub Token 只通过环境变量或用户输入提供。
- 不在日志中打印 token。
- GitHub 写操作先生成草稿，人工确认并通过权限和参数校验后执行。
- 对话确认复用已有草稿 ID，不新建草稿；重复确认不会重复写入。
- GitHub Token 如需持久化，必须加密保存。
