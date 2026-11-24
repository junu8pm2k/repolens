"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileSearch,
  FileText,
  History,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  TestTube2,
  Trash2,
  X
} from "lucide-react";

import { PageTitle } from "@/components/ui/card";
import type { FilePreview, PreviewFile } from "@/components/rag/indexed-file-preview";
import { RetrievalSettings } from "@/components/rag/retrieval-settings";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api";
import { groupKnowledgeFiles, type FileDescription } from "@/lib/knowledge-file-categories";
import {
  formatBytes,
  formatDate,
  formatNumber,
  statusLabel,
  type IndexedFile,
  type KnowledgeBase,
  type KnowledgeChunk,
  type KnowledgeConfig,
  type KnowledgeDocument,
  type ModelCatalog,
  type RetrievalHistory,
  type RetrievalResponse
} from "@/lib/rag";

type Tab = "documents" | "qa" | "retrieval" | "settings";

const KnowledgeQuestions = dynamic(() => import("@/components/rag/knowledge-questions").then((module) => module.KnowledgeQuestions));
const IndexedFilePreview = dynamic(() => import("@/components/rag/indexed-file-preview").then((module) => module.IndexedFilePreview));

const tabs: { value: Tab; label: string; icon: typeof FileText }[] = [
  { value: "documents", label: "文档", icon: FileText },
  { value: "qa", label: "知识问答", icon: Sparkles },
  { value: "retrieval", label: "召回测试", icon: TestTube2 },
  { value: "settings", label: "设置", icon: Settings }
];

const pipelineStageLabel: Record<string, string> = {
  vector_recall: "向量召回",
  keyword_recall: "BM25 召回",
  weighted_fusion: "加权融合",
  single_retriever_selection: "单路候选",
  deduplication_and_parent_aggregation: "去重聚合",
  rerank: "重排",
  parent_expansion: "父级扩展",
  score_threshold: "分数门槛",
  context_compression: "证据压缩",
  answer_gate: "回答判断"
};

const answerGateLabel: Record<string, string> = {
  answer: "证据充足",
  ask_clarification: "需要补充范围",
  insufficient_evidence: "证据不足",
  conflict: "证据冲突"
};

export default function KnowledgeBaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense fallback={<KnowledgeLoading />}>
      <KnowledgeBaseDetail key={id} id={id} />
    </Suspense>
  );
}

function KnowledgeLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-slate-500">
      <LoaderCircle className="h-4 w-4 animate-spin" /> 正在加载项目知识...
    </div>
  );
}

function KnowledgeBaseDetail({ id }: { id: string }) {
  const selectedTab = useSearchParams().get("tab");
  const tab = tabs.find((item) => item.value === selectedTab)?.value ?? "documents";
  const fileInput = useRef<HTMLInputElement>(null);
  const loadRequest = useRef(0);
  const [questionsOpened, setQuestionsOpened] = useState(false);
  const [knowledge, setKnowledge] = useState<KnowledgeBase | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [indexedFiles, setIndexedFiles] = useState<IndexedFile[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [config, setConfig] = useState<KnowledgeConfig | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [query, setQuery] = useState("");
  const [retrieval, setRetrieval] = useState<RetrievalResponse | null>(null);
  const [history, setHistory] = useState<RetrievalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [activeDocument, setActiveDocument] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    const [base, docs, files] = await Promise.all([
      apiGet<KnowledgeBase>(`/api/rag/repositories/${id}`),
      apiGet<KnowledgeDocument[]>(`/api/rag/repositories/${id}/documents`),
      apiGet<IndexedFile[]>(`/api/rag/repositories/${id}/indexed-files`)
    ]);
    if (loadRequest.current !== request) return;
    setKnowledge(base);
    setDocuments(docs);
    setIndexedFiles(files);
    setConfig((current) => current ?? base.config);
  }, [id]);

  const loadHistory = useCallback(() => {
    apiGet<RetrievalHistory[]>(`/api/rag/repositories/${id}/retrieval-tests`).then(setHistory).catch(() => null);
  }, [id]);

  useEffect(() => {
    let ignore = false;
    load()
      .catch((reason: Error) => { if (!ignore) setError(reason.message); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => {
      ignore = true;
      loadRequest.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (tab === "qa") setQuestionsOpened(true);
    if (tab === "retrieval") loadHistory();
  }, [tab, loadHistory]);

  useEffect(() => {
    if (tab !== "settings" || catalog) return;
    let ignore = false;
    apiGet<ModelCatalog>("/api/rag/models")
      .then((models) => { if (!ignore) setCatalog(models); })
      .catch((reason: Error) => { if (!ignore) setError(reason.message); });
    return () => { ignore = true; };
  }, [tab, catalog]);

  useEffect(() => {
    if (!documents.some((item) => !["completed", "failed"].includes(item.status))) return;
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      await load().catch(() => null);
      checking = false;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [documents, load]);

  function changeTab(next: Tab) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append("file", file);
        await apiUpload<KnowledgeDocument>(`/api/rag/repositories/${id}/documents`, form);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openChunks(file: PreviewFile) {
    setPreview({ file, status: "loading" });
    try {
      const chunks = await apiGet<KnowledgeChunk[]>(file.endpoint);
      setPreview((current) => current?.file === file ? { file, status: "ready", chunks } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "读取分段失败";
      setPreview((current) => current?.file === file ? { file, status: "error", message } : current);
    }
  }

  async function changeDocument(document: KnowledgeDocument, action: "retry" | "delete") {
    if (activeDocument || indexing) return;
    if (action === "delete" && !window.confirm(`删除“${document.name}”及其分段？`)) return;
    setActiveDocument(document.id);
    setError("");
    setMessage("");
    const path = `/api/rag/repositories/${id}/documents/${document.id}`;
    try {
      if (action === "retry") {
        await apiPost(`${path}/retry`, {});
      } else {
        await apiDelete(path);
        setDocuments((current) => current.filter((item) => item.id !== document.id));
        setPreview((current) => current?.file.id === document.id ? null : current);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文档操作失败");
    } finally {
      setActiveDocument(null);
    }
  }

  async function rebuildIndex() {
    if (indexing || uploading || activeDocument) return;
    setIndexing(true);
    setError("");
    setMessage("");
    try {
      const result = await apiPost<{ indexed_documents: number }>(`/api/rag/${id}/reindex`, {});
      await load();
      setMessage(`已重建 ${result.indexed_documents} 个文档向量。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重建索引失败");
    } finally {
      setIndexing(false);
    }
  }

  async function runRetrieval() {
    if (!query.trim() || !config) return;
    setTesting(true);
    setError("");
    try {
      const result = await apiPost<RetrievalResponse>(`/api/rag/repositories/${id}/retrieval-tests`, {
        query: query.trim(),
        top_k: config.top_k,
        retrieval_method: config.retrieval_method,
        rerank_enabled: config.rerank_enabled,
        score_threshold_enabled: config.score_threshold_enabled,
        score_threshold: config.score_threshold
      });
      setRetrieval(result);
      loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "召回测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings() {
    if (!config || !knowledge || indexing || saving) return;
    setSaving(true);
    setMessage("");
    setError("");
    const reindexNeeded = config.embedding_model !== knowledge.config.embedding_model || config.embedding_provider !== knowledge.config.embedding_provider;
    try {
      const updated = await apiPatch<KnowledgeBase>(`/api/rag/repositories/${id}/config`, config);
      setKnowledge(updated);
      setConfig(updated.config);
      if (reindexNeeded && updated.chunk_count) {
        await apiPost(`/api/rag/${id}/reindex`, {});
        setMessage("设置已保存，现有分段已重新向量化。平时修改分段长度只会影响新上传的文档。");
      } else {
        setMessage("设置已保存。");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <KnowledgeLoading />;
  }
  if (!knowledge || !config) {
    return <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error || "未找到仓库"}</div>;
  }

  return (
    <div className="flex min-h-[calc(100vh-81px)] shrink-0 flex-col">
      <PageTitle
        title={knowledge.name}
        description={`${knowledge.full_name} · ${formatNumber(indexedFiles.length)} 个仓库文件 · ${formatNumber(documents.length)} 个上传文件`}
        actions={
          <Link
            href="/knowledge"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-600 shadow-xs transition-colors hover:bg-panel hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> 全部知识库
          </Link>
        }
      />

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-white shadow-xs md:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="flex flex-col border-b border-line bg-panel/60 p-3 md:border-b-0 md:border-r">
          <nav className="no-scrollbar flex gap-1 overflow-x-auto md:block md:space-y-1">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => changeTab(item.value)}
                  aria-pressed={tab === item.value}
                  className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors md:w-full ${
                    tab === item.value ? "bg-accent-soft font-medium text-indigo-700" : "text-slate-600 hover:bg-white hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-4 hidden border-t border-line pt-4 md:block">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">运行状态</div>
            <div className="mt-3 space-y-3 rounded-lg border border-line bg-white p-3 text-xs leading-5">
              <div>
                <div className="text-slate-400">Embedding</div>
                <div className={`mt-0.5 inline-flex items-center gap-1.5 font-medium ${knowledge.runtime.embedding.available ? "text-emerald-700" : "text-amber-700"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${knowledge.runtime.embedding.available ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {knowledge.runtime.embedding.available
                    ? `${knowledge.runtime.embedding.provider} 就绪`
                    : `${knowledge.runtime.embedding.provider} 不可用`}
                </div>
                {knowledge.runtime.embedding.dimensions ? (
                  <p className="text-slate-500">{knowledge.runtime.embedding.dimensions} 维</p>
                ) : null}
              </div>
              <div>
                <div className="text-slate-400">Rerank</div>
                <div className={`mt-0.5 inline-flex items-center gap-1.5 font-medium ${knowledge.runtime.rerank.available ? "text-emerald-700" : "text-amber-700"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${knowledge.runtime.rerank.available ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {knowledge.runtime.rerank.available
                    ? `${knowledge.runtime.rerank.provider} 就绪`
                    : knowledge.runtime.rerank.fallback === "heuristic"
                      ? "启发式重排"
                      : `${knowledge.runtime.rerank.provider} 不可用`}
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 bg-white p-4 sm:p-6">
          {error ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <span>{error}</span>
              <button onClick={() => setError("")} title="关闭" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-rose-600 transition-colors hover:bg-rose-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {message ? (
            <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
              <Check className="h-4 w-4" /> {message}
            </div>
          ) : null}

          {(questionsOpened || tab === "qa") && (
            <div hidden={tab !== "qa"}>
              <KnowledgeQuestions repoId={id} active={tab === "qa"} />
            </div>
          )}

          {tab === "documents" ? (
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-ink">文档</h2>
                  <p className="mt-1 text-sm text-slate-500">按文件路径和标题自动分组。打开卡片查看索引分段。</p>
                </div>
                <input ref={fileInput} type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx,.json,.csv,.log" className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={rebuildIndex} disabled={indexing || uploading || Boolean(activeDocument) || saving} className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-slate-700 hover:bg-panel disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4 ${indexing ? "animate-spin" : ""}`} /> 重建索引
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading || indexing}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 添加文件
                  </button>
                </div>
              </div>

              <section className="mt-6" aria-labelledby="repository-files-heading">
                <h3 id="repository-files-heading" className="text-sm font-semibold text-ink">仓库索引文件</h3>
                {indexedFiles.length ? (
                  <FileCardGroups
                    files={indexedFiles}
                    describe={(file) => ({ path: file.path, title: file.title, manifest: file.source_type === "project_manifest" })}
                    renderCard={(file) => (
                      <FileCard
                        name={file.path.split("/").at(-1) || file.path}
                        detail={file.path}
                        chunks={file.chunk_count}
                        onOpen={() => openChunks({
                          id: file.id,
                          name: file.title,
                          filename: file.path,
                          detail: `${file.path} · ${formatNumber(file.chunk_count)} 个分段`,
                          endpoint: `/api/rag/repositories/${id}/indexed-files/${file.id}/chunks`
                        })}
                      />
                    )}
                  />
                ) : (
                  <p className="mt-3 rounded-lg border border-dashed border-line bg-panel/40 px-4 py-4 text-sm text-slate-500">还没有仓库索引文件。可在 Workspace 的「记忆&知识库」扫描项目文档。</p>
                )}
              </section>

              <section className="mt-7" aria-labelledby="uploaded-files-heading">
                <h3 id="uploaded-files-heading" className="text-sm font-semibold text-ink">上传文件</h3>
                {documents.length ? (
                  <FileCardGroups
                    files={documents}
                    describe={(document) => ({ path: document.name })}
                    renderCard={(document) => (
                      <FileCard
                        name={document.name}
                        detail={`${formatDate(document.created_at)} · ${formatNumber(document.character_count)} 字符`}
                        chunks={document.chunk_count}
                        errorMessage={document.error_message}
                        status={document.status}
                        onOpen={() => openChunks({
                          id: document.id,
                          name: document.name,
                          filename: document.name,
                          detail: `${formatNumber(document.chunk_count)} 个分段 · ${formatBytes(document.file_size)}`,
                          endpoint: `/api/rag/repositories/${id}/documents/${document.id}/chunks`
                        })}
                        actions={(
                          <>
                            {document.status === "failed" && (
                              <button type="button" onClick={() => changeDocument(document, "retry")} disabled={Boolean(activeDocument) || indexing} aria-label={`重试 ${document.name}`} title="重试" className="grid h-8 w-8 place-items-center rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}
                            <button type="button" onClick={() => changeDocument(document, "delete")} disabled={Boolean(activeDocument) || indexing || !["completed", "failed"].includes(document.status)} aria-label={`删除 ${document.name}`} title="删除文档" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      />
                    )}
                  />
                ) : (
                  <p className="mt-3 rounded-lg border border-dashed border-line bg-panel/40 px-4 py-4 text-sm text-slate-500">还没有上传文件。可以通过「添加文件」导入资料。</p>
                )}
              </section>
            </div>
          ) : null}

          {tab === "retrieval" ? (
            <div className="mx-auto max-w-7xl">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-ink">召回测试</h2>
                <p className="mt-1 text-sm text-slate-500">输入真实问题，观察被召回的分段、分数和排序。</p>
              </div>
              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(360px,.72fr)_minmax(520px,1.28fr)]">
                <div className="space-y-5">
                  <section className="rounded-xl border border-line bg-white p-5 shadow-xs">
                    <label className="text-xs font-medium text-slate-600">查询文本</label>
                    <textarea
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runRetrieval();
                      }}
                      maxLength={250}
                      placeholder="例如：新员工可以请几天年假？"
                      className="mt-2 min-h-36 w-full resize-y rounded-lg border border-line bg-white p-3 text-sm leading-6 text-ink outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-slate-400">{query.length} / 250</span>
                      <button
                        type="button"
                        disabled={!query.trim() || testing}
                        onClick={runRetrieval}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {testing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 测试
                      </button>
                    </div>
                  </section>
                  <section className="rounded-xl border border-line bg-white p-5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
                        <History className="h-4 w-4 text-slate-400" /> 测试记录
                      </h3>
                      <span className="text-xs text-slate-400">最近 {history.length} 条</span>
                    </div>
                    <div className="mt-3 divide-y divide-line">
                      {history.map((item) => (
                        <div key={item.id} className="py-3">
                          <div className="truncate text-sm text-slate-700">{item.query}</div>
                          <div className="mt-1 flex gap-3 text-xs text-slate-400">
                            <span>{item.result_count} 条结果</span>
                            <span>{item.took_ms} ms</span>
                            <span>{formatDate(item.created_at)}</span>
                          </div>
                        </div>
                      ))}
                      {!history.length ? <div className="py-8 text-center text-xs text-slate-400">暂无测试记录</div> : null}
                    </div>
                  </section>
                </div>

                <section className="min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold tracking-tight text-ink">召回结果</h3>
                    {retrieval ? <span className="text-xs text-slate-500">{retrieval.result_count} 条 · {retrieval.took_ms} ms</span> : null}
                  </div>
                  {retrieval?.retrieval_config.pipeline?.stages?.length ? (
                    <div className="mt-3 rounded-xl border border-line bg-white p-4 shadow-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium text-slate-600">Retrieval Trace</div>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${retrieval.retrieval_config.answer_gate?.decision === "answer" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                          {answerGateLabel[String(retrieval.retrieval_config.answer_gate?.decision ?? "")] ?? "等待判断"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {retrieval.retrieval_config.pipeline.stages.map((stage, index) => {
                          const name = String(stage.name ?? "unknown");
                          const outputCount = stage.output_count ?? stage.candidate_count;
                          return (
                            <div key={`${name}-${index}`} className="flex items-center gap-2">
                              {index ? <span className="text-slate-300">→</span> : null}
                              <span className="rounded-md border border-line bg-panel px-2 py-1 text-xs text-slate-600">
                                {pipelineStageLabel[name] ?? name}{typeof outputCount === "number" ? ` · ${outputCount}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {retrieval.retrieval_config.answer_gate?.reason ? <p className="mt-3 text-xs leading-5 text-slate-500">{retrieval.retrieval_config.answer_gate.reason}</p> : null}
                    </div>
                  ) : null}
                  <div className="mt-3 space-y-3">
                    {retrieval?.results.map((result, index) => (
                      <article key={`${result.document_id}-${index}`} className="rounded-lg border border-line bg-white p-4 shadow-xs transition-colors hover:border-indigo-200 hover:bg-indigo-50/50">
                        <div className="flex items-center gap-3 border-b border-line pb-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-indigo-700">{index + 1}</span>
                          <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-medium text-ink">{result.title}</h4><p className="mt-0.5 truncate text-xs text-slate-400">{String(result.metadata.filename ?? result.source_type)}</p></div>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{result.score.toFixed(3)}</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{result.snippet}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400"><span>分段 #{String(result.metadata.chunk_index ?? index + 1)}</span><span>{result.snippet.length} 字符</span><span>{String(result.retrieval.keyword_backend ?? result.retrieval.vector_backend ?? "retrieval")}</span><span>{String(result.retrieval.fusion_method ?? retrieval.retrieval_config.fusion_method ?? config.retrieval_method)}</span><span>{String(result.retrieval.rerank_mode ?? result.retrieval.mode ?? "retrieval")}</span></div>
                      </article>
                    ))}
                    {!retrieval ? (
                      <div className="flex min-h-80 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-white/60 px-6 text-center">
                        <span className="grid h-10 w-10 place-items-center rounded-lg border border-accent-line bg-accent-soft text-indigo-600">
                          <FileSearch className="h-5 w-5" />
                        </span>
                        <p className="text-sm font-medium text-slate-600">输入问题后查看真实召回分段</p>
                        <p className="text-xs leading-5 text-slate-400">结果会展示分数、来源和检索链路。</p>
                      </div>
                    ) : null}
                    {retrieval && !retrieval.results.length ? (
                      <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-line bg-white/60 text-sm text-slate-500">没有分段通过当前检索条件。</div>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {tab === "settings" ? (
            <div className="mx-auto max-w-4xl">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-ink">知识库设置</h2>
                <p className="mt-1 text-sm text-slate-500">控制后续入库和召回测试使用的模型与参数。</p>
              </div>
              <div className="mt-5 rounded-xl border border-line bg-white p-5 shadow-xs sm:p-7">
                <RetrievalSettings value={config} catalog={catalog} onChange={setConfig} />
                <div className="mt-6 flex justify-end border-t border-line pt-5">
                  <button
                    type="button"
                    onClick={saveSettings}
                    disabled={saving || indexing || config.chunk_overlap >= config.chunk_size}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存设置
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {preview && <IndexedFilePreview preview={preview} onClose={() => setPreview(null)} onRetry={() => openChunks(preview.file)} />}
    </div>
  );
}

function FileCardGroups<T extends { id: string }>({ files, describe, renderCard }: {
  files: readonly T[];
  describe: (file: T) => FileDescription;
  renderCard: (file: T) => ReactNode;
}) {
  return (
    <div className="mt-3 divide-y divide-line">
      {groupKnowledgeFiles(files, describe).map((group) => (
        <div key={group.id} className="py-4 first:pt-0 last:pb-0">
          <h4 className="flex items-baseline gap-2 text-sm font-medium text-slate-700">
            {group.label}
            <span className="text-xs font-normal text-slate-500">{formatNumber(group.files.length)} 个文件</span>
          </h4>
          <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.files.map((file) => <li key={file.id}>{renderCard(file)}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FileCard({ name, detail, chunks, status, errorMessage, actions, onOpen }: {
  name: string;
  detail: string;
  chunks: number;
  status?: KnowledgeDocument["status"];
  errorMessage?: string;
  actions?: ReactNode;
  onOpen: () => void;
}) {
  const canOpen = !status || status === "completed";
  const tone = status === "completed" ? "text-emerald-700" : status === "failed" ? "text-rose-700" : "text-amber-700";

  return (
    <div className="h-full min-w-0 rounded-xl border border-line bg-white">
      <button
        type="button"
        disabled={!canOpen}
        onClick={onOpen}
        className="flex w-full gap-3 rounded-xl p-3.5 text-left enabled:hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <FileText aria-hidden="true" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span title={name} className="block truncate text-sm font-semibold text-ink">{name}</span>
          <span title={detail} className="mt-1 block truncate text-xs text-slate-500">{detail}</span>
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{formatNumber(chunks)} 个分段</span>
            {status && <span className={tone}>{statusLabel[status]}</span>}
          </span>
        </span>
        {canOpen && <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
      </button>
      {actions && (
        <div className="mx-3.5 flex items-center justify-end gap-1 border-t border-line py-1">
          {errorMessage && <span title={errorMessage} className="mr-auto truncate text-xs text-rose-700">{errorMessage}</span>}
          {actions}
        </div>
      )}
    </div>
  );
}
