"use client";

import { useEffect, useState } from "react";
import { CircleDot, Sparkles } from "lucide-react";

import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type Issue = { id: string; number: number; title: string; state: string; labels: string[]; body?: string };

function stateBadgeClass(state: string) {
  if (state === "open") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "closed") return "border-line bg-slate-100 text-slate-600";
  return "border-line bg-panel text-slate-600";
}

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [analysis, setAnalysis] = useState("");

  useEffect(() => {
    apiGet<Repository[]>("/api/repos").then((repos) => {
      if (repos[0]) {
        apiGet<Issue[]>(`/api/repos/${repos[0].id}/issues`).then((items) => {
          setIssues(items);
          setSelected(items[0] ?? null);
        });
      }
    });
  }, []);

  async function analyze() {
    if (!selected) return;
    const data = await apiPost(`/api/issues/${selected.id}/analyze`, {});
    setAnalysis(JSON.stringify(data, null, 2));
  }

  return (
    <>
      <PageTitle title="Issue 智能分析" description="自动生成 Issue 分类、优先级、复杂度、负责人建议、相似问题和下一步行动项。" />

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <CircleDot className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">Issue 列表</h2>
            </div>
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{issues.length} 条</span>
          </div>

          <div className="mt-4 space-y-2">
            {issues.map((issue) => {
              const active = selected?.id === issue.id;
              return (
                <button
                  key={issue.id}
                  onClick={() => setSelected(issue)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active ? "border-indigo-300 bg-indigo-50" : "border-line bg-white hover:border-indigo-200 hover:bg-indigo-50/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`min-w-0 text-sm font-medium ${active ? "text-indigo-900" : "text-ink"}`}>
                      #{issue.number} {issue.title}
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${stateBadgeClass(issue.state)}`}>{issue.state}</span>
                  </div>
                  {issue.labels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {issue.labels.map((label) => (
                        <span key={label} className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-slate-500">{label}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
            {issues.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-4 py-10 text-center">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <CircleDot className="h-4 w-4" />
                </span>
                <p className="mt-2 text-sm text-slate-500">暂无 Issue 记录。</p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <Sparkles className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">分析结果</h2>
          </div>

          {selected ? (
            <>
              <div className="mt-4 rounded-lg border border-line bg-panel/60 p-4">
                <div className="text-sm font-medium text-ink">#{selected.number} {selected.title}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{selected.body || "暂无正文"}</p>
              </div>

              <div className="mt-4">
                <PrimaryButton onClick={analyze} disabled={!selected}>
                  <Sparkles className="h-4 w-4" />
                  分析当前 Issue
                </PrimaryButton>
              </div>

              {analysis && (
                <div className="mt-4 border-t border-line pt-4">
                  <div className="mb-1.5 text-xs font-medium text-slate-500">分析结果 JSON</div>
                  <pre className="max-h-[480px] overflow-auto rounded-lg border border-line bg-panel p-4 font-mono text-xs leading-6 text-slate-700">{analysis}</pre>
                </div>
              )}
            </>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-4 py-12 text-center">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <CircleDot className="h-4 w-4" />
              </span>
              <p className="mt-2 text-sm text-slate-500">暂无可分析的 Issue。</p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
