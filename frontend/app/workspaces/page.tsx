"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarRange, FileText, Layers } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";

type Workspace = {
  id: string;
  name: string;
  description?: string | null;
  repo_ids: string[];
};

type MultiRepoReport = {
  report_markdown: string;
  metrics: Record<string, number>;
  repo_summaries: Array<Record<string, unknown>>;
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

const fieldClass =
  "mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function WorkspacesPage() {
  const today = useMemo(() => new Date(), []);
  const start = useMemo(() => {
    const value = new Date(today);
    value.setDate(value.getDate() - 6);
    return value;
  }, [today]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState("研发团队");
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [startDate, setStartDate] = useState(toDateInput(start));
  const [endDate, setEndDate] = useState(toDateInput(today));
  const [report, setReport] = useState<MultiRepoReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [repoItems, workspaceItems] = await Promise.all([apiGet<Repository[]>("/api/repos"), apiGet<Workspace[]>("/api/workspaces")]);
    setRepos(repoItems);
    setWorkspaces(workspaceItems);
    setSelectedRepos(repoItems.slice(0, 2).map((repo) => repo.id));
    setWorkspaceId(workspaceItems[0]?.id || "");
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function createWorkspace() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await apiPost<Workspace>("/api/workspaces", { name, repo_ids: selectedRepos });
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    setLoading(true);
    try {
      const data = await apiPost<MultiRepoReport>("/api/workspaces/multi-repo-report", {
        workspace_id: workspaceId || undefined,
        repo_ids: workspaceId ? [] : selectedRepos,
        start_date: startDate,
        end_date: endDate
      });
      setReport(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle
        title="团队工作区"
        description="把多个仓库聚合成 workspace，生成跨仓库研发周报和风险概览。"
        actions={
          <Link href="/reports" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-600 hover:bg-panel">
            <FileText className="h-4 w-4" /> 单仓库周报
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <Layers className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">创建 Workspace</h2>
          </div>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Workspace 名称
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <div className="mt-4">
            <div className="text-sm font-medium text-slate-700">仓库</div>
            <div className="mt-2 grid gap-2">
              {repos.map((repo) => {
                const checked = selectedRepos.includes(repo.id);
                return (
                  <label
                    key={repo.id}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                      checked ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-line bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-line accent-indigo-600 focus:ring-2 focus:ring-indigo-100"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedRepos((current) => (event.target.checked ? [...current, repo.id] : current.filter((id) => id !== repo.id)));
                      }}
                    />
                    <span className="truncate">{repo.full_name}</span>
                  </label>
                );
              })}
              {repos.length === 0 && <p className="text-sm text-slate-500">暂无已连接仓库。</p>}
            </div>
          </div>

          <PrimaryButton className="mt-4 w-full" disabled={loading || selectedRepos.length === 0} onClick={createWorkspace}>
            <Layers className="h-4 w-4" />
            创建 Workspace
          </PrimaryButton>

          <div className="mt-5 border-t border-line pt-5">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <CalendarRange className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">报表范围</h2>
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              Workspace
              <select className={fieldClass} value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
                <option value="">使用上方勾选仓库</option>
                {workspaces.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm font-medium text-slate-700">
                开始日期
                <input type="date" className={fieldClass} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label className="text-sm font-medium text-slate-700">
                结束日期
                <input type="date" className={fieldClass} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
            </div>

            <PrimaryButton className="mt-4 w-full" disabled={loading || (!workspaceId && selectedRepos.length === 0)} onClick={generateReport}>
              <BarChart3 className="h-4 w-4" />
              生成多仓库周报
            </PrimaryButton>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <Layers className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold tracking-tight text-ink">Workspace 列表</h2>
              </div>
              <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{workspaces.length} 个</span>
            </div>
            <div className="mt-4 grid gap-2">
              {workspaces.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel/60 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-indigo-600 ring-1 ring-line">
                      <Layers className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate text-sm font-medium text-ink">{item.name}</span>
                  </div>
                  <span className="shrink-0 rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">{item.repo_ids.length} 个仓库</span>
                </div>
              ))}
              {workspaces.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-4 py-10 text-center">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                    <Layers className="h-4 w-4" />
                  </span>
                  <p className="mt-2 text-sm text-slate-500">暂无 workspace。</p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <FileText className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold tracking-tight text-ink">多仓库周报</h2>
              </div>
              {report && (
                <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{report.report_markdown.length.toLocaleString("zh-CN")} 字符</span>
              )}
            </div>
            {report ? (
              <pre className="mt-4 max-h-[620px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel p-5 font-sans text-sm leading-7 text-slate-700">{report.report_markdown}</pre>
            ) : (
              <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-6 py-12 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="mt-3 text-sm font-medium text-ink">尚未生成周报</div>
                <p className="mt-1 text-sm text-slate-500">创建 workspace 或勾选仓库后生成周报。</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
