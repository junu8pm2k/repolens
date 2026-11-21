"use client";

import { LoaderCircle, Search, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { apiGet, apiPost } from "@/lib/api";
import type { RetrievalResult } from "@/lib/rag";

type RagStatus = {
  source_types: Record<string, number>;
  vector_store: { backend?: string; status?: string; available?: boolean };
  generation: { llm_configured?: boolean; model?: string | null };
};

type RagAnswer = {
  answer: string;
  sources: RetrievalResult[];
  generation_mode: "llm" | "extractive" | "direct" | "no_evidence";
  took_ms: number;
};

type RagSearch = {
  query: string;
  results: RetrievalResult[];
  took_ms: number;
};

const answerModes: Record<RagAnswer["generation_mode"], string> = {
  llm: "LLM 生成",
  extractive: "证据提取",
  direct: "实时查询",
  no_evidence: "证据不足"
};

const sourceTypes: Record<string, string> = {
  git_commit: "Git 提交",
  knowledge_file: "文档",
  memory_note: "笔记",
  project_doc: "项目文档",
  project_overview: "项目概览",
  issue: "Issue",
  pull_request: "PR",
  workflow_run: "CI",
  team_member: "成员",
  weekly_report: "周报"
};

const questionFieldClass =
  "h-9 rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

function sourceLabel(type: string) {
  return sourceTypes[type] ?? type.replaceAll("_", " ");
}

function Sources({ items }: { items: RetrievalResult[] }) {
  return (
    <ol className="mt-3 space-y-2">
      {items.map((source) => (
        <li key={`${source.document_id}:${source.citation}`} className="rounded-lg border border-line bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="shrink-0 text-xs font-semibold text-indigo-700">[{source.citation}]</span>
            <span className="min-w-0 break-words text-sm font-medium text-ink">{source.title}</span>
            <span className="text-xs text-slate-500">{sourceLabel(source.source_type)} · {source.score.toFixed(3)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{source.snippet}</p>
          {Boolean(source.metadata.filename || source.metadata.path) && (
            <p className="mt-2 break-all text-xs text-slate-500">{String(source.metadata.filename || source.metadata.path)}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export function KnowledgeQuestions({ repoId, active }: { repoId: string; active: boolean }) {
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [sourceType, setSourceType] = useState("");
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [turns, setTurns] = useState<Array<{ question: string; result: RagAnswer }>>([]);
  const [search, setSearch] = useState<RagSearch | null>(null);
  const [busy, setBusy] = useState<"ask" | "search" | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const availableSources = Object.keys(status?.source_types ?? {}).sort();
  const selectedSource = availableSources.includes(sourceType) ? sourceType : "";

  useEffect(() => {
    if (!active) return;
    let ignore = false;
    apiGet<RagStatus>(`/api/rag/${repoId}/status`)
      .then((value) => { if (!ignore) setStatus(value); })
      .catch(() => { if (!ignore) setStatus(null); });
    return () => { ignore = true; };
  }, [repoId, active]);

  useEffect(() => () => request.current?.abort(), []);

  async function runQuery(mode: "ask" | "search") {
    const prompt = question.trim();
    if (!prompt || request.current) return;

    const controller = new AbortController();
    request.current = controller;
    const payload = { question: prompt, top_k: topK, source_types: selectedSource ? [selectedSource] : [] };
    const options = { signal: controller.signal };
    setBusy(mode);
    setError("");
    try {
      if (mode === "ask") {
        const result = await apiPost<RagAnswer>(`/api/rag/${repoId}/ask`, payload, options);
        if (controller.signal.aborted) return;
        setTurns((current) => [{ question: prompt, result }, ...current]);
        setQuestion("");
      } else {
        const result = await apiPost<RagSearch>(`/api/rag/${repoId}/search`, payload, options);
        if (!controller.signal.aborted) setSearch(result);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "请求失败，请重试。");
      }
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setBusy(null);
      }
    }
  }

  function clear() {
    request.current?.abort();
    request.current = null;
    setBusy(null);
    setTurns([]);
    setSearch(null);
    setError("");
  }

  return (
    <section className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink">知识问答</h2>
          <p className="mt-1 text-sm text-slate-500">在当前项目检索资料，查看回答及所引用的原文。</p>
          {status && (
            <p className="mt-2 text-xs text-slate-500">
              {status.generation.llm_configured ? status.generation.model ?? "LLM 生成" : "本地证据模式"}
              {" · 向量索引 "}
              {status.vector_store.available === false ? "不可用" : status.vector_store.status ?? "就绪"}
            </p>
          )}
        </div>
        {(turns.length > 0 || search || busy) && (
          <button type="button" onClick={clear} className="rounded-md border border-line px-3 py-1.5 text-sm text-slate-600 hover:bg-panel">
            清空问答与检索结果
          </button>
        )}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void runQuery("ask"); }} className="rounded-xl border border-line bg-panel/40 p-4">
        <label htmlFor="knowledge-question" className="text-sm font-medium text-ink">问题</label>
        <textarea
          id="knowledge-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void runQuery("ask");
            }
          }}
          rows={3}
          maxLength={4000}
          disabled={Boolean(busy)}
          placeholder="向当前知识库提问"
          className="mt-2 w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={selectedSource} onChange={(event) => setSourceType(event.target.value)} className={questionFieldClass} aria-label="资料类型">
            <option value="">全部资料</option>
            {availableSources.map((type) => <option key={type} value={type}>{sourceLabel(type)}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Top K
            <select value={topK} onChange={(event) => setTopK(Number(event.target.value))} className={questionFieldClass}>
              {[3, 5, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => runQuery("search")} disabled={!question.trim() || Boolean(busy)} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm text-slate-700 hover:bg-panel disabled:opacity-40">
              <Search className="h-4 w-4" /> 只检索证据
            </button>
            <button type="submit" disabled={!question.trim() || Boolean(busy)} className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40">
              <Send className="h-4 w-4" /> 提问
            </button>
          </div>
        </div>
        {busy && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <LoaderCircle className="h-4 w-4 animate-spin" /> {busy === "ask" ? "正在检索并生成回答" : "正在检索证据"}
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      </form>

      {search && (
        <section aria-label="检索结果" className="rounded-xl border border-line p-4">
          <h3 className="break-words text-sm font-semibold text-ink">{search.query}</h3>
          <p className="mt-1 text-xs text-slate-500">检索到 {search.results.length} 条证据 · {search.took_ms} ms</p>
          <Sources items={search.results} />
        </section>
      )}

      {turns.map(({ question: prompt, result }, index) => (
        <article key={turns.length - index} className="rounded-xl border border-line p-4">
          <h3 className="whitespace-pre-wrap break-words text-sm font-semibold text-ink">{prompt}</h3>
          <div className="markdown-body mt-3 break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
          </div>
          <p className="mt-3 text-xs text-slate-500">{answerModes[result.generation_mode]} · {result.took_ms} ms</p>
          {result.sources.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-indigo-700">引用证据（{result.sources.length}）</summary>
              <Sources items={result.sources} />
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
