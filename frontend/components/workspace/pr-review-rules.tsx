"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { PrimaryButton } from "@/components/ui/card";
import { apiGet, apiPatch } from "@/lib/api";

type ReviewRulesResponse = { rules: string };

export function PRReviewRules({ repoId }: { repoId: string }) {
  const panelId = useId();
  const fieldId = useId();
  const [expanded, setExpanded] = useState(false);
  const [savedRules, setSavedRules] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/repos/${repoId}/pr-review-rules`;

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const { rules } = await apiGet<ReviewRulesResponse>(endpoint);
      setSavedRules(rules);
      setDraft(rules);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取规则失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savedRules === null || draft === savedRules || saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const { rules } = await apiPatch<ReviewRulesResponse>(endpoint, { rules: draft });
      setSavedRules(rules);
      setDraft(rules);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存规则失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-3 rounded-xl border border-line bg-white">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          setExpanded(!expanded);
          if (!expanded && savedRules === null && !loading) void loadRules();
        }}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
      >
        <span className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-accent" />
          PR 审查规则
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div id={panelId} hidden={!expanded} className="border-t border-line px-3 py-3">
        {loading && <p role="status" className="text-sm text-slate-500">正在读取规则…</p>}
        {error && <p role="alert" className="mb-2 text-sm text-rose-700">{error}</p>}
        {savedRules === null && error && (
          <button type="button" onClick={loadRules} className="text-sm font-medium text-accent underline">
            重新读取
          </button>
        )}
        {savedRules !== null && (
          <form onSubmit={saveRules} className="space-y-2">
            <label htmlFor={fieldId} className="block text-xs font-medium text-slate-700">仓库规则</label>
            <p id={`${fieldId}-help`} className="text-xs leading-5 text-slate-500">
              每行一条，保存后用于此仓库的后续 PR 审查。清空并保存可移除全部规则。
            </p>
            <textarea
              id={fieldId}
              aria-describedby={`${fieldId}-help`}
              rows={4}
              maxLength={4000}
              value={draft}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
              }}
              placeholder="例如，修改数据库表结构时，检查是否提供回滚方案。"
              className="block w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-panel"
            />
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton type="submit" disabled={saving || draft === savedRules}>
                {saving ? "保存中…" : "保存规则"}
              </PrimaryButton>
              {saved && <p role="status" className="text-xs text-emerald-700">规则已保存</p>}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
