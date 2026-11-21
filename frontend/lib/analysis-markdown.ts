type DuplicateCandidate = {
  issue_id: string;
  title: string;
  score: number;
};

type IssueEvidence = {
  source_type: string;
  title: string;
  snippet: string;
  reference?: string | null;
  confidence?: number | null;
};

type IssueDrafts = {
  clarification_comment?: string | null;
  task_breakdown?: string | null;
};

export type IssueAnalysisResult = {
  summary: string;
  conclusion: "进入开发" | "等待澄清" | "关闭" | "拆分" | "合并到已有 Issue" | string;
  conclusion_reason: string;
  category: string;
  priority: "P0" | "P1" | "P2" | "P3" | string;
  complexity: "S" | "M" | "L" | "XL" | string;
  suggested_owner: string;
  owner_reason: string;
  duplicate_candidates?: DuplicateCandidate[];
  evidence?: IssueEvidence[];
  checklist?: string[];
  action_items?: string[];
  drafts?: IssueDrafts;
  confidence: number;
};

export type PRAnalysisResult = {
  summary: string;
  plan?: string[];
  executed_steps?: string[];
  merge_recommendation: "建议合入" | "修改后合入" | "暂缓" | "拒绝" | string;
  recommendation_reason?: string;
  key_changes?: string[];
  risk_points?: string[];
  blocking_issues?: string[];
  review_checklist?: string[];
  test_suggestions?: string[];
  files_need_attention?: string[];
  review_comments?: string[];
  confidence: number;
};

export type CIAnalysisResult = {
  failure_summary: string;
  failure_type: "test" | "build" | "lint" | "dependency" | "permission" | "environment" | "unknown" | string;
  plan?: string[];
  executed_steps?: string[];
  first_error?: string | null;
  root_cause?: string;
  possible_causes?: string[];
  fix_steps?: string[];
  debug_steps?: string[];
  related_files?: string[];
  is_merge_blocking: boolean;
  blocking_reason?: string;
  confidence: number;
};

function text(value?: string | null): string {
  return (value ?? "").trim().replace(/[\\`*_\[\]<>#|~&]/g, "\\$&");
}

function blocks(...items: (string | undefined)[]): string {
  return items.filter(Boolean).join("\n\n");
}

function bullets(items: string[] = []): string {
  return items.map(text).filter(Boolean).map((item) => `- ${item.replace(/\r?\n/g, "\n  ")}`).join("\n");
}

function section(level: 2 | 3, title: string, ...body: (string | undefined)[]): string {
  const content = blocks(...body);
  return content ? `${"#".repeat(level)} ${title}\n\n${content}` : "";
}

function codeBlock(content: string): string {
  const longestBackticks = (content.match(/`{3,}/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2);
  const fence = "`".repeat(longestBackticks + 1);
  return `${fence}text\n${content}${content.endsWith("\n") ? "" : "\n"}${fence}`;
}

function confidence(value = 0): string {
  return `置信度：${Math.round(value * 100)}%`;
}

export function issueAnalysisMarkdown(title: string, result: IssueAnalysisResult, checklist: string[]): string {
  const evidence = (result.evidence ?? []).map((item) => {
    const source = typeof item.confidence === "number"
      ? `${item.source_type} · ${confidence(item.confidence)}`
      : item.source_type;
    const snippet = text(item.snippet);
    return blocks(`**${text(item.title)}**（${text(source)}）`, snippet && snippet.replace(/^/gm, "> "));
  });

  return blocks(
    `# ${text(title)}`,
    section(2, "分析结论", bullets([
      `结论：${result.conclusion}`, `优先级：${result.priority}`, `复杂度：${result.complexity}`,
      `分类：${result.category}`, confidence(result.confidence)
    ]), text(result.conclusion_reason || result.summary)),
    section(2, "建议负责人", text(result.suggested_owner), text(result.owner_reason)),
    section(2, "证据", blocks(...evidence) || "暂无可用证据。"),
    section(2, "下一步 checklist", bullets(checklist)),
    section(2, "可选草稿",
      section(3, "澄清评论", result.drafts?.clarification_comment || undefined),
      section(3, "任务拆分说明", result.drafts?.task_breakdown || undefined))
  );
}

export function prAnalysisMarkdown(title: string, result: PRAnalysisResult): string {
  return blocks(
    `# ${text(title)}`,
    section(2, "合入建议", bullets([
      `建议：${result.merge_recommendation}`, confidence(result.confidence),
      `风险点：${result.risk_points?.length ?? 0}`, `阻塞项：${result.blocking_issues?.length ?? 0}`
    ]), text(result.recommendation_reason || result.summary)),
    section(2, "Review 计划与执行",
      section(3, "计划", bullets(result.plan)),
      section(3, "已执行", bullets(result.executed_steps))),
    section(2, "变更与风险",
      section(3, "关键变更", bullets(result.key_changes)),
      section(3, "风险点", bullets(result.risk_points)),
      section(3, "阻塞项", bullets(result.blocking_issues)),
      section(3, "重点文件", bullets(result.files_need_attention))),
    section(2, "合入前动作",
      section(3, "Review checklist", bullets(result.review_checklist)),
      section(3, "测试建议", bullets(result.test_suggestions))),
    section(2, "Review comments 摘要", bullets(result.review_comments))
  );
}

export function ciAnalysisMarkdown(title: string, result: CIAnalysisResult): string {
  return blocks(
    `# ${text(title)}`,
    section(2, "失败结论", bullets([
      `失败类型：${result.failure_type}`, result.is_merge_blocking ? "阻塞合并" : "不阻塞合并",
      confidence(result.confidence)
    ]), text(result.root_cause || result.failure_summary), text(result.blocking_reason)),
    section(2, "排查计划与执行",
      section(3, "计划", bullets(result.plan)),
      section(3, "已执行", bullets(result.executed_steps))),
    section(2, "首个关键错误块", result.first_error ? codeBlock(result.first_error) : undefined),
    section(2, "根因与修复",
      section(3, "可能原因", bullets(result.possible_causes)),
      section(3, "修复步骤", bullets(result.fix_steps)),
      section(3, "排查步骤", bullets(result.debug_steps)),
      section(3, "相关文件", bullets(result.related_files)))
  );
}
