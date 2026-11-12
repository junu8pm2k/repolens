"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database, GitBranch, ListChecks, Sparkles, Workflow } from "lucide-react";

import { apiGet } from "@/lib/api";
import type { Repository } from "@/lib/types";
import { PageTitle } from "@/components/ui/card";

type WorkflowTask = {
  id: string;
  task_id: string;
  agent_name: string;
  task_type: string;
  status: string;
  summary: string;
  error?: string | null;
};

type WorkflowRun = {
  id: string;
  repo_id?: string | null;
  goal: string;
  status: string;
  spec: { workflow_id?: string; tasks?: Array<{ id: string; dependencies?: string[] }> };
  observation: { status?: string; confidence?: number; findings?: Array<{ severity?: string; message?: string }> };
  final_answer: string;
  metrics: Record<string, number | string>;
  created_at?: string | null;
  completed_at?: string | null;
  tasks: WorkflowTask[];
};

const statusLabel: Record<string, string> = {
  success: "运行成功",
  completed: "运行成功",
  failed: "运行失败",
  running: "运行中"
};

const selectClass =
  "mt-2 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

function statusBadgeClass(status: string) {
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "running") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "success" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-line bg-panel text-slate-600";
}

function severityDotClass(severity?: string) {
  if (severity === "error" || severity === "critical" || severity === "high") return "bg-rose-500";
  if (severity === "warning" || severity === "medium") return "bg-amber-500";
  return "bg-slate-400";
}

export default function WorkflowRunsPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        setRepos(items);
        setRepoId(items[0]?.id || "");
      })
      .catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    if (!repoId) return;
    setLoading(true);
    apiGet<WorkflowRun[]>(`/api/chat/workflow-runs?repo_id=${repoId}`)
      .then((items) => {
        setRuns(items);
        setSelectedId((current) => (items.some((item) => item.id === current) ? current : items[0]?.id || ""));
      })
      .finally(() => setLoading(false));
  }, [repoId]);

  const selected = useMemo(() => runs.find((item) => item.id === selectedId) ?? runs[0], [runs, selectedId]);
  const completedTasks = selected?.tasks.filter((task) => task.status === "success" || task.status === "completed").length ?? 0;
  const findings = selected?.observation.findings ?? [];

  return (
    <>
      <PageTitle title="工作流运行记录" description="按一次工程目标查看 Planner 任务图、各 Agent 执行结果、Observer 发现和最终综合结论。" />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.4fr)_repeat(3,minmax(160px,1fr))]">
        <div className="rounded-xl border border-line bg-white p-4 shadow-xs">
          <label className="block text-xs font-medium text-slate-500">
            仓库
            <select className={selectClass} value={repoId} onChange={(event) => setRepoId(event.target.value)}>
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}
            </select>
          </label>
        </div>
        <Metric icon={Workflow} label="工作流" value={runs.length} />
        <Metric icon={CheckCircle2} label="完成任务" value={completedTasks} />
        <Metric icon={AlertTriangle} label="Observer 发现" value={findings.length} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="self-start rounded-xl border border-line bg-white p-3 shadow-xs">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-xs font-medium text-slate-500">运行列表</span>
            <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] font-medium text-slate-500">{runs.length}</span>
          </div>
          <div className="space-y-2">
            {runs.map((run) => {
              const active = selected?.id === run.id;
              return (
                <button
                  key={run.id}
                  onClick={() => setSelectedId(run.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    active ? "border-indigo-300 bg-indigo-50" : "border-line bg-white hover:border-indigo-200 hover:bg-indigo-50/50"
                  }`}
                >
                  <div className={`line-clamp-2 text-sm font-semibold ${active ? "text-indigo-900" : "text-ink"}`}>{run.goal}</div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${run.status === "failed" ? "bg-rose-500" : run.status === "running" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      {statusLabel[run.status] || run.status}
                    </span>
                    <span>{run.created_at ? new Date(run.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  </div>
                </button>
              );
            })}
            {!loading && runs.length === 0 && (
              <div className="rounded-lg border border-dashed border-line bg-panel/40 px-4 py-8 text-center text-sm text-slate-500">暂无工作流运行记录。</div>
            )}
          </div>
        </aside>

        <main className="min-w-0">
          {selected ? (
            <div className="space-y-4">
              <section className="rounded-xl border border-line bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(selected.status)}`}>
                    {statusLabel[selected.status] || selected.status}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <GitBranch className="h-3.5 w-3.5" />
                    {selected.spec.workflow_id || selected.id.slice(0, 8)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Database className="h-3.5 w-3.5" />
                    已持久化
                  </span>
                </div>
                <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">{selected.goal}</h2>
              </section>

              <section className="rounded-xl border border-line bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                      <ListChecks className="h-4 w-4" />
                    </span>
                    <h3 className="text-base font-semibold tracking-tight text-ink">Agent 执行链</h3>
                  </div>
                  <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">
                    {completedTasks}/{selected.tasks.length} 完成
                  </span>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {selected.tasks.map((task, index) => {
                    const done = task.status === "success" || task.status === "completed";
                    return (
                      <div key={task.id} className="rounded-lg border border-line bg-panel/50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="grid h-7 w-7 place-items-center rounded-md bg-white text-xs font-semibold text-indigo-600 ring-1 ring-line">{index + 1}</span>
                          {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock3 className="h-4 w-4 text-amber-600" />}
                        </div>
                        <div className="mt-3 truncate text-sm font-semibold text-ink">{task.agent_name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{task.task_type}</div>
                        <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{task.summary || "任务已完成"}</p>
                      </div>
                    );
                  })}
                  {selected.tasks.length === 0 && (
                    <div className="col-span-full rounded-lg border border-dashed border-line bg-panel/40 px-4 py-6 text-center text-sm text-slate-500">暂无 Agent 执行记录。</div>
                  )}
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
                <div className="rounded-xl border border-accent-line bg-accent-soft/70 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
                    <Sparkles className="h-4 w-4" />
                    Synthesis 最终结论
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-700">{selected.final_answer}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
                  <div className="flex items-center justify-between gap-2 text-sm font-semibold text-amber-900">
                    <span className="inline-flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Observer 交叉检查
                    </span>
                    {typeof selected.observation.confidence === "number" && (
                      <span className="rounded-full border border-amber-200 bg-white/70 px-2 py-0.5 text-xs font-medium">
                        置信度 {Math.round(selected.observation.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    {findings.map((finding, index) => (
                      <div key={index} className="flex gap-2 text-sm leading-6 text-slate-700">
                        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${severityDotClass(finding.severity)}`} />
                        <span className="min-w-0">{finding.message}</span>
                      </div>
                    ))}
                    {findings.length === 0 && <div className="text-sm text-slate-500">暂无交叉检查发现。</div>}
                  </div>
                </div>
              </section>

              <div className="flex items-center gap-2 border-t border-line pt-3 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5" />
                创建于 {selected.created_at ? new Date(selected.created_at).toLocaleString("zh-CN") : "未知"}，完成后写入 workflow 与 task 两级记录。
              </div>
            </div>
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <Workflow className="h-5 w-5" />
              </span>
              <div className="mt-3 text-sm font-medium text-ink">
                {loading ? "正在读取工作流记录..." : runs.length === 0 ? "暂无工作流运行记录。" : "请选择一条运行记录。"}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Workflow; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-xs">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-indigo-600">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}
