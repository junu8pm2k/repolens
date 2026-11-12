"use client";

import { useEffect, useState } from "react";
import { GitPullRequest, Sparkles } from "lucide-react";

import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type PullRequest = {
  id: string;
  number: number;
  title: string;
  state: string;
  files: { filename: string; additions: number; deletions: number }[];
};

function stateBadgeClass(state: string) {
  if (state === "open") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "merged") return "border-violet-200 bg-violet-50 text-violet-700";
  if (state === "closed") return "border-line bg-slate-100 text-slate-600";
  return "border-line bg-panel text-slate-600";
}

export default function PullRequestsPage() {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [selected, setSelected] = useState<PullRequest | null>(null);
  const [analysis, setAnalysis] = useState("");

  useEffect(() => {
    apiGet<Repository[]>("/api/repos").then((repos) => {
      if (repos[0]) {
        apiGet<PullRequest[]>(`/api/repos/${repos[0].id}/pull-requests`).then((items) => {
          setPrs(items);
          setSelected(items[0] ?? null);
        });
      }
    });
  }, []);

  async function analyze() {
    if (!selected) return;
    const data = await apiPost(`/api/pull-requests/${selected.id}/analyze`, {});
    setAnalysis(JSON.stringify(data, null, 2));
  }

  return (
    <>
      <PageTitle title="PR Review 助手" description="读取 changed files 和 diff，生成 PR 摘要、风险点、Review Checklist 与测试建议。" />

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <GitPullRequest className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">Pull Requests</h2>
            </div>
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{prs.length} 个</span>
          </div>

          <div className="mt-4 space-y-2">
            {prs.map((pr) => {
              const active = selected?.id === pr.id;
              return (
                <button
                  key={pr.id}
                  onClick={() => setSelected(pr)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active ? "border-indigo-300 bg-indigo-50" : "border-line bg-white hover:border-indigo-200 hover:bg-indigo-50/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`min-w-0 text-sm font-medium ${active ? "text-indigo-900" : "text-ink"}`}>
                      #{pr.number} {pr.title}
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${stateBadgeClass(pr.state)}`}>{pr.state}</span>
                  </div>
                </button>
              );
            })}
            {prs.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-4 py-10 text-center">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <GitPullRequest className="h-4 w-4" />
                </span>
                <p className="mt-2 text-sm text-slate-500">暂无 Pull Request 记录。</p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <Sparkles className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">Review 报告</h2>
          </div>

          {selected ? (
            <>
              <div className="mt-4 rounded-lg border border-line bg-panel/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-ink">#{selected.number} {selected.title}</div>
                  <span className="rounded-full border border-line bg-white px-2.5 py-0.5 text-xs font-medium text-slate-500">{selected.files.length} 个文件</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {selected.files.map((file) => (
                    <div key={file.filename} className="flex items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2">
                      <span className="truncate font-mono text-xs text-slate-600">{file.filename}</span>
                      <span className="shrink-0 text-xs font-medium">
                        <span className="text-emerald-600">+{file.additions}</span>
                        <span className="mx-1 text-slate-300">/</span>
                        <span className="text-rose-600">-{file.deletions}</span>
                      </span>
                    </div>
                  ))}
                  {selected.files.length === 0 && <div className="rounded-md border border-dashed border-line bg-white px-3 py-4 text-center text-xs text-slate-500">暂无 changed files。</div>}
                </div>
              </div>

              <div className="mt-4">
                <PrimaryButton onClick={analyze} disabled={!selected}>
                  <Sparkles className="h-4 w-4" />
                  生成 PR 分析
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
                <GitPullRequest className="h-4 w-4" />
              </span>
              <p className="mt-2 text-sm text-slate-500">暂无可 Review 的 Pull Request。</p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
