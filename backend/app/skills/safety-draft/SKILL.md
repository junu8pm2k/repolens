---
name: safety-draft
title: 安全草稿
version: 0.1.1
description: 识别有风险的外部发送或 GitHub 写操作，生成可人工确认的草稿，而不是直接执行写入。
category: safety
entrypoint: safety_agent.classify_action_risk
tools:
  - safety_agent.classify_action_risk
  - repolens_search_evidence
input_modes:
  - write_intent_from_chat
  - external_send_intent
triggers:
  - 评论
  - 回复
  - comment
  - 打标签
  - label
  - 关闭 issue
  - 创建 issue
  - 发送报告
  - 外部发送
  - 写入
workflow_steps:
  - detect_write_or_send_intent
  - classify_action_risk
  - draft_human_reviewable_output
  - require_confirmation
output_contract: SafetyDraft
safety_level: guarded_write_draft
---

# 安全草稿

当用户要求评论、回复、打标签、关闭 Issue、创建 Issue、发送报告，或执行任何对话外写操作时，使用这个技能。

## 工作流

1. 识别外部写入或发送意图。
2. 判断操作风险，并识别敏感上下文。
3. 传入明确的操作类型、实际标题和正文；评论、关闭和标签操作必须指定目标编号。创建 Issue 不需要已有编号。
4. 生成可由人工审阅的草稿，展示草稿 ID 和实际发布内容；缺少必要参数时先澄清，不保存无效草稿。
5. 写清确认后将执行对应操作。用户确认已有草稿时复用草稿 ID，不再次生成草稿。

## 边界

本技能只负责起草，不执行外部写入。用户可在安全草稿页面确认，或在对话中发送“确认执行：草稿 ID”；服务端校验权限和草稿参数后，调用独立的确认接口执行。报告发送尚未接入外部渠道，只记录状态。
