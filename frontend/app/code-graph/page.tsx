"use client";

import { useEffect, useState } from "react";
import { Boxes, FileCode2, FileSearch, GitBranch, ScanSearch, Waypoints } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";

type PullRequest = {
  id: string;
  number: number;
  title: string;
  head_branch?: string | null;
};

type CodeGraph = {
  query: string;
  symbols: Array<{ id: string; path: string; name: string; kind: string; start_line?: number | null; pr_number?: number | null }>;
  relations: Array<{ id: string; source_name?: string | null; target_name: string; relation_type: string; path?: string | null; pr_number?: number | null }>;
  documents: Array<{ id: string; title: string; path?: string; snippet: string; pr_number?: number | null }>;
};

type PrSnapshot = {
  status: string;
  message?: string | null;
  snapshot_name?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  pr_id?: string | null;
  pr_number?: number | null;
  indexed_symbols?: number | null;
};

const fieldClass =
  "mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function CodeGraphPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [prId, setPrId] = useState("");
  const [query, setQuery] = useState("");
  const [graph, setGraph] = useState<CodeGraph | null>(null);
  const [snapshot, setSnapshot] = useState<PrSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadPrs(id: string) {
    if (!id) return;
    const items = await apiGet<PullRequest[]>(`/api/repos/${id}/pull-requests`).catch(() => []);
    setPrs(items);
    setPrId(items[0]?.id || "");
    setSnapshot(null);
  }

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        setRepos(items);
        setRepoId(items[0]?.id || "");
        return loadPrs(items[0]?.id || "");
      })
      .catch(() => setRepos([]));
  }, []);

  async function searchGraph(snapshotPrId?: string) {
    if (!repoId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query });
      const activeSnapshotPrId = snapshotPrId ?? (snapshot?.status === "ready" ? prId : "");
      if (activeSnapshotPrId) params.set("pr_id", activeSnapshotPrId);
      setGraph(await apiGet<CodeGraph>(`/api/repos/${repoId}/code-graph/search?${params.toString()}`));
    } finally {
      setLoading(false);
    }
  }

  async function prepareSnapshot() {
    if (!prId) return;
    setLoading(true);
    try {
      const nextSnapshot = await apiPost<PrSnapshot>(`/api/pull-requests/${prId}/snapshot`, {});
      setSnapshot(nextSnapshot);
      await searchGraph(nextSnapshot.status === "ready" ? prId : undefined);
    } finally {
      setLoading(false);
    }
  }

  const symbols = graph?.symbols || [];
  const relations = (graph?.relations || []).slice(0, 30);
  const documents = graph?.documents || [];
  const snapshotReady = snapshot?.status === "ready";

  return (
    <>
      <PageTitle title="代码图谱" description="检索代码 symbol、调用/导入关系，并为 PR 准备独立分支快照。" />

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <ScanSearch className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">代码检索</h2>
          </div>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            仓库
            <select
              className={fieldClass}
              value={repoId}
              onChange={(event) => {
                setRepoId(event.target.value);
                setGraph(null);
                loadPrs(event.target.value);
              }}
            >
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}
            </select>
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            搜索 symbol / path
            <input className={fieldClass} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>

          <PrimaryButton className="mt-4 w-full" disabled={!repoId || loading} onClick={() => searchGraph()}>
            搜索图谱
          </PrimaryButton>

          <div className="mt-5 border-t border-line pt-5">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                <GitBranch className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight text-ink">PR 分支快照</h2>
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              Pull Request
              <select
                className={fieldClass}
                value={prId}
                onChange={(event) => {
                  setPrId(event.target.value);
                  setSnapshot(null);
                  setGraph(null);
                }}
              >
                {prs.length === 0 && <option value="">暂无 Pull Request</option>}
                {prs.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    #{pr.number} {pr.title}
                  </option>
                ))}
              </select>
            </label>

            <PrimaryButton className="mt-3 w-full" disabled={!prId || loading} onClick={prepareSnapshot}>
              准备 PR 快照
            </PrimaryButton>

            {snapshot && (
              <div className="mt-4 rounded-lg border border-line bg-panel/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium text-ink">{snapshot.snapshot_name || "PR 分支快照"}</div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
                      snapshotReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {snapshot.status}
                  </span>
                </div>
                <dl className="mt-3 space-y-1.5 text-xs">
                  {snapshot.branch && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">分支</dt>
                      <dd className="truncate font-mono text-slate-700">{snapshot.branch}</dd>
                    </div>
                  )}
                  {snapshot.commit_sha && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Commit</dt>
                      <dd className="truncate font-mono text-slate-700">{snapshot.commit_sha.slice(0, 12)}</dd>
                    </div>
                  )}
                  {typeof snapshot.indexed_symbols === "number" && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">代码图符号</dt>
                      <dd className="font-medium text-slate-700">{snapshot.indexed_symbols}</dd>
                    </div>
                  )}
                </dl>
                {snapshot.message && <p className="mt-2.5 text-xs leading-5 text-slate-500">{snapshot.message}</p>}
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <Boxes className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold tracking-tight text-ink">Symbols</h2>
              </div>
              <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{symbols.length}</span>
            </div>
            <div className="mt-4 grid gap-2">
              {symbols.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-panel/50 px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{item.name}</span>
                  <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-slate-500">{item.kind}</span>
                  <span className="font-mono text-xs text-slate-500">{item.path}:{item.start_line || 1}</span>
                  {item.pr_number ? (
                    <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-indigo-700">PR #{item.pr_number}</span>
                  ) : null}
                </div>
              ))}
              {!graph && <EmptyHint icon={FileSearch} text="索引代码后可搜索 symbol。" />}
              {graph && symbols.length === 0 && <EmptyHint icon={FileSearch} text="没有匹配的 symbol。" />}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <Waypoints className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold tracking-tight text-ink">Relations</h2>
              </div>
              <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{graph?.relations.length ?? 0}</span>
            </div>
            <div className="mt-4 grid gap-2">
              {relations.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-panel/50 px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{item.source_name || item.path || "module"}</span>
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-indigo-700">{item.relation_type}</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-slate-700">{item.target_name}</span>
                  {item.pr_number ? (
                    <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-indigo-700">PR #{item.pr_number}</span>
                  ) : null}
                </div>
              ))}
              {!graph && <EmptyHint icon={Waypoints} text="索引代码后可查看调用与导入关系。" />}
              {graph && relations.length === 0 && <EmptyHint icon={Waypoints} text="没有匹配的关系。" />}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
                  <FileCode2 className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold tracking-tight text-ink">相关代码片段</h2>
              </div>
              <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-slate-500">{documents.length}</span>
            </div>
            <div className="mt-4 grid gap-2">
              {documents.map((item) => (
                <div key={item.id} className="overflow-hidden rounded-lg border border-line">
                  <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-2">
                    <span className="truncate text-xs font-medium text-ink">{item.title}</span>
                    {item.pr_number ? (
                      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-indigo-700">PR #{item.pr_number}</span>
                    ) : null}
                  </div>
                  <pre className="max-h-48 overflow-auto bg-white p-3 font-mono text-xs leading-6 text-slate-700">{item.snippet}</pre>
                </div>
              ))}
              {!graph && <EmptyHint icon={FileCode2} text="搜索后可查看相关代码片段。" />}
              {graph && documents.length === 0 && <EmptyHint icon={FileCode2} text="没有匹配的代码片段。" />}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function EmptyHint({ icon: Icon, text }: { icon: typeof Boxes; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/40 px-4 py-8 text-center">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-indigo-600">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-2 text-sm text-slate-500">{text}</p>
    </div>
  );
}
