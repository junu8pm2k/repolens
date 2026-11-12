"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, FileText } from "lucide-react";

import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type WeeklyReportResponse = {
  report_markdown: string;
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

const fieldClass =
  "mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function ReportsPage() {
  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => {
    const date = new Date(today);
    date.setDate(date.getDate() - 6);
    return date;
  }, [today]);

  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [startDate, setStartDate] = useState(toDateInput(weekStart));
  const [endDate, setEndDate] = useState(toDateInput(today));
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        setRepos(items);
        setRepoId(items[0]?.id || "");
      })
      .catch(() => setRepos([]));
  }, []);

  async function generateReport() {
    if (!repoId) return;
    setLoading(true);
    try {
      const data = await apiPost<WeeklyReportResponse>("/api/reports/weekly", {
        repo_id: repoId,
        start_date: startDate,
        end_date: endDate
      });
      setReport(data.report_markdown);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle title="研发周报生成" description="按时间范围统计 Issues、PRs、Merged PRs、Open PRs 和失败 CI，生成适合发给团队负责人的 Markdown 周报。" />

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <CalendarRange className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">生成参数</h2>
          </div>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            仓库
            <select className={fieldClass} value={repoId} onChange={(event) => setRepoId(event.target.value)}>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>{repo.full_name}</option>
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

          <PrimaryButton className="mt-4 w-full" onClick={generateReport} disabled={!repoId || loading}>
            <FileText className="h-4 w-4" />
            {loading ? "生成中..." : "生成周报"}
          </PrimaryButton>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <FileText className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">Markdown 周报</h2>
            </div>
            {report && (
              <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{report.length.toLocaleString("zh-CN")} 字符</span>
            )}
          </div>

          {report ? (
            <pre className="mt-4 max-h-[640px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel p-5 font-sans text-sm leading-7 text-slate-700">{report}</pre>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-6 py-12 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <FileText className="h-5 w-5" />
              </span>
              <div className="mt-3 text-sm font-medium text-ink">尚未生成周报</div>
              <p className="mt-1 text-sm text-slate-500">选择仓库和时间范围后生成周报。</p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
