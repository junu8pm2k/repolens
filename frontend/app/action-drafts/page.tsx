"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Clock3, FileText, Send, ShieldAlert, X } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";

type ActionDraft = {
  id: string;
  repo_id: string;
  draft_type: string;
  target_type: string;
  title: string;
  content: string;
  risk_level: string;
  status: string;
  execution_result?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  executed_at?: string | null;
};

type AuditLog = { id: string; action: string; status: string; target_type?: string | null; target_id?: string | null; created_at: string };

const statusMeta: Record<string, { label: string; className: string }> = {
  pending_confirmation: { label: "等待人工确认", className: "bg-amber-50 text-amber-800 border-amber-200" },
  executed: { label: "已确认并执行", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "已取消", className: "bg-slate-100 text-slate-600 border-slate-200" },
  failed: { label: "执行失败", className: "bg-rose-50 text-rose-700 border-rose-200" }
};

const fieldClass =
  "mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function ActionDraftsPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [drafts, setDrafts] = useState<ActionDraft[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [title, setTitle] = useState("发布检查报告");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRepoId = useRef("");
  const loadRequest = useRef(0);

  const load = useCallback(async (repo = activeRepoId.current) => {
    const request = ++loadRequest.current;
    if (!repo) return;
    setError(null);
    try {
      const suffix = `?repo_id=${repo}`;
      const [draftItems, auditItems] = await Promise.all([
        apiGet<ActionDraft[]>(`/api/action-drafts${suffix}`),
        apiGet<AuditLog[]>(`/api/action-drafts/audit-logs${suffix}`).catch(() => [])
      ]);
      if (activeRepoId.current !== repo || request !== loadRequest.current) return;
      setDrafts(draftItems);
      setAudits(auditItems);
    } catch (loadError) {
      if (activeRepoId.current === repo && request === loadRequest.current) setError(loadError instanceof Error ? loadError.message : "加载草稿失败");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        if (cancelled) return;
        setRepos(items);
        activeRepoId.current = items[0]?.id || "";
        setRepoId(items[0]?.id || "");
        return load(items[0]?.id || "");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载仓库失败");
      });
    return () => { cancelled = true; activeRepoId.current = ""; loadRequest.current += 1; };
  }, [load]);

  async function createDraft() {
    if (!repoId || !content.trim()) return;
    const currentRepo = repoId;
    setLoading(true);
    setError(null);
    try {
      await apiPost<ActionDraft>("/api/action-drafts", {
        repo_id: repoId,
        draft_type: "send_report",
        target_type: "repository",
        title: title.trim() || "发布检查报告",
        content,
        risk_level: "medium",
        metadata: { source: "manual_review" }
      });
      if (activeRepoId.current !== currentRepo) return;
      setContent("");
      await load(currentRepo);
    } catch (createError) {
      if (activeRepoId.current === currentRepo) setError(createError instanceof Error ? createError.message : "创建草稿失败");
    } finally {
      if (activeRepoId.current === currentRepo) setLoading(false);
    }
  }

  async function changeDraft(id: string, action: "confirm" | "cancel") {
    const currentRepo = repoId;
    setLoading(true);
    setError(null);
    try {
      await apiPost(`/api/action-drafts/${id}/${action}`, {});
      if (activeRepoId.current === currentRepo) await load(currentRepo);
    } catch (changeError) {
      if (activeRepoId.current === currentRepo) setError(changeError instanceof Error ? changeError.message : "更新草稿失败");
    } finally {
      if (activeRepoId.current === currentRepo) setLoading(false);
    }
  }

  const pendingCount = useMemo(() => drafts.filter((draft) => draft.status === "pending_confirmation").length, [drafts]);
  const executedCount = useMemo(() => drafts.filter((draft) => draft.status === "executed").length, [drafts]);
  const visibleAudits = audits.slice(0, 10);

  return (
    <>
      <PageTitle title="安全草稿与人工确认" description="Agent 的外部写操作先落成可审查草稿；只有具备批准权限的人确认后，系统才执行并写入审计记录。" />
      {error && <div role="alert" className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <Summary icon={FileText} label="全部草稿" value={drafts.length} />
        <Summary icon={Clock3} label="待确认" value={pendingCount} tone="amber" />
        <Summary icon={CheckCircle2} label="已执行" value={executedCount} tone="green" />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">创建安全草稿</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">这里只保存建议内容，不会直接写入外部系统。</p>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            仓库
            <select
              className={fieldClass}
              value={repoId}
              disabled={loading}
              onChange={(event) => {
                activeRepoId.current = event.target.value;
                loadRequest.current += 1;
                setRepoId(event.target.value);
                setDrafts([]);
                setAudits([]);
                void load(event.target.value);
              }}
            >
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}
            </select>
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            标题
            <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            待审查内容
            <textarea
              className="mt-2 min-h-40 w-full resize-none rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="输入准备发送的报告或评论内容"
            />
          </label>
          <PrimaryButton className="mt-4 w-full" disabled={!repoId || !content.trim() || loading} onClick={createDraft}>
            <FileText className="h-4 w-4" />
            保存为待确认草稿
          </PrimaryButton>
        </Card>

        <div className="space-y-4">
          {drafts.map((draft) => {
            const meta = statusMeta[draft.status] || { label: draft.status, className: "bg-panel text-slate-600 border-line" };
            return (
              <article key={draft.id} className="rounded-xl border border-line bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold tracking-tight text-ink">{draft.title || draft.draft_type}</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${draft.risk_level === "high" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                        {draft.risk_level === "high" ? "高风险" : "中低风险"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {draft.draft_type} · {draft.target_type} · {new Date(draft.created_at).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  {draft.status === "pending_confirmation" && (
                    <div className="flex gap-2">
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={loading}
                        onClick={() => changeDraft(draft.id, "confirm")}
                      >
                        <Check className="h-3.5 w-3.5" />
                        确认执行
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={loading}
                        onClick={() => changeDraft(draft.id, "cancel")}
                      >
                        <X className="h-3.5 w-3.5" />
                        取消
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-4 whitespace-pre-wrap rounded-lg bg-accent-soft/60 px-4 py-3 text-sm leading-7 text-slate-700">{draft.content}</div>
                {draft.status === "executed" && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    人工确认完成，执行结果和操作者已经写入审计记录。
                  </div>
                )}
                {draft.error_message && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{draft.error_message}</div>}
              </article>
            );
          })}
          {drafts.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <FileText className="h-5 w-5" />
              </span>
              <div className="mt-3 text-sm font-medium text-ink">暂无安全草稿</div>
              <p className="mt-1 text-sm text-slate-500">在左侧填写内容后保存为待确认草稿。</p>
            </div>
          )}

          <Card>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <Send className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">审计时间线</h2>
              <span className="ml-auto rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{audits.length} 条</span>
            </div>
            <div className="mt-4">
              {visibleAudits.map((item, index) => (
                <div key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < visibleAudits.length - 1 && <span className="absolute left-[4px] top-4 h-full w-px bg-line" />}
                  <span className={`relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.status === "success" ? "bg-emerald-500" : "bg-rose-500"}`} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{auditLabel(item.action)}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{item.status} · {new Date(item.created_at).toLocaleString("zh-CN")}</div>
                  </div>
                </div>
              ))}
              {audits.length === 0 && <div className="rounded-lg border border-dashed border-line bg-panel/40 px-4 py-6 text-center text-sm text-slate-500">暂无审计记录。</div>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
  tone = "accent"
}: {
  icon: typeof FileText;
  label: string;
  value: number;
  tone?: "accent" | "amber" | "green";
}) {
  const badge = tone === "amber" ? "bg-amber-50 text-amber-600" : tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-accent-soft text-indigo-600";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-xs">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${badge}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}

function auditLabel(action: string) {
  if (action.startsWith("action_draft.confirm")) return "人工确认并执行草稿";
  if (action === "action_draft.create") return "创建待确认草稿";
  if (action === "action_draft.cancel") return "取消草稿";
  return action;
}
