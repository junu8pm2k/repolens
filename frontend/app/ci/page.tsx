"use client";

import { useEffect, useState } from "react";
import { Sparkles, Workflow, Wrench } from "lucide-react";

import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type WorkflowRun = {
  id: string;
  name: string;
  status: string;
  conclusion?: string | null;
  logs_text?: string | null;
  jobs?: Array<{ name?: string; conclusion?: string; steps?: Array<{ name?: string; conclusion?: string }> }>;
};

function conclusionBadgeClass(conclusion?: string | null) {
  if (conclusion === "failure") return "border-rose-200 bg-rose-50 text-rose-700";
  if (conclusion === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-line bg-panel text-slate-600";
}

export default function CIPage() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selected, setSelected] = useState<WorkflowRun | null>(null);
  const [analysis, setAnalysis] = useState("");

  useEffect(() => {
    apiGet<Repository[]>("/api/repos").then((repos) => {
      if (repos[0]) {
        apiGet<WorkflowRun[]>(`/api/repos/${repos[0].id}/workflow-runs`).then((items) => {
          setRuns(items);
          setSelected(items.find((item) => item.conclusion === "failure") ?? items[0] ?? null);
        });
      }
    });
  }, []);

  async function analyze() {
    if (!selected) return;
    const data = await apiPost(`/api/workflow-runs/${selected.id}/analyze`, {});
    setAnalysis(JSON.stringify(data, null, 2));
  }

  const failedJobs = (selected?.jobs ?? []).filter((job) => job.conclusion === "failure");

  return (
    <>
      <PageTitle title="CI Debug 分析" description="聚合 GitHub Actions 运行状态和失败日志，生成失败归因、排查步骤和相关风险提示。" />

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <Workflow className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">Workflow Runs</h2>
            </div>
            <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{runs.length} 次</span>
          </div>

          <div className="mt-4 space-y-2">
            {runs.map((run) => {
              const active = selected?.id === run.id;
              return (
                <button
                  key={run.id}
                  onClick={() => setSelected(run)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active ? "border-indigo-300 bg-indigo-50" : "border-line bg-white hover:border-indigo-200 hover:bg-indigo-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`min-w-0 truncate text-sm font-medium ${active ? "text-indigo-900" : "text-ink"}`}>{run.name}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${conclusionBadgeClass(run.conclusion)}`}>
                      {run.conclusion ?? run.status}
                    </span>
                  </div>
                </button>
              );
            })}
            {runs.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-4 py-10 text-center">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <Workflow className="h-4 w-4" />
                </span>
                <p className="mt-2 text-sm text-slate-500">暂无 Workflow Run。</p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <Wrench className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">排查建议</h2>
          </div>

          {selected ? (
            <>
              {(selected.jobs?.length ?? 0) > 0 && (
                <div className="mt-4 rounded-lg border border-line bg-panel/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-500">失败 Job</div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${failedJobs.length > 0 ? "border-rose-200 bg-white text-rose-700" : "border-emerald-200 bg-white text-emerald-700"}`}>
                      {failedJobs.length > 0 ? `${failedJobs.length} 个` : "全部通过"}
                    </span>
                  </div>
                  {failedJobs.map((job) => (
                    <div key={job.name} className="mt-3">
                      <div className="text-sm font-medium text-ink">{job.name}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {job.steps?.filter((step) => step.conclusion === "failure").map((step) => (
                          <span key={step.name} className="rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700">
                            {step.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selected.logs_text && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs font-medium text-slate-500">日志片段</div>
                  <pre className="max-h-44 overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-xs leading-5 text-slate-600">{selected.logs_text}</pre>
                </div>
              )}

              <div className="mt-4">
                <PrimaryButton onClick={analyze} disabled={!selected}>
                  <Sparkles className="h-4 w-4" />
                  分析失败原因
                </PrimaryButton>
              </div>

              {analysis && (
                <div className="mt-4 border-t border-line pt-4">
                  <div className="mb-1.5 text-xs font-medium text-slate-500">分析结果</div>
                  <pre className="max-h-[480px] overflow-auto rounded-lg border border-line bg-panel p-4 font-mono text-xs leading-6 text-slate-700">{analysis}</pre>
                </div>
              )}
            </>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-4 py-12 text-center">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <Wrench className="h-4 w-4" />
              </span>
              <p className="mt-2 text-sm text-slate-500">{runs.length === 0 ? "暂无 CI 运行记录。" : "请选择一条运行记录。"}</p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
