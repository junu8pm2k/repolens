"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, BookOpen, FileText, GitBranch, LoaderCircle, Search } from "lucide-react";

import { PageTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import { formatDate, formatNumber, type KnowledgeBase } from "@/lib/rag";

export default function KnowledgeBasesPage() {
  return (
    <Suspense>
      <KnowledgeBases />
    </Suspense>
  );
}

function KnowledgeBases() {
  const openQuestions = useSearchParams().get("tab") === "qa";
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<KnowledgeBase[]>("/api/rag/repositories")
      .then(setItems)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  const visible = items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageTitle
        title="项目知识"
        description="每个 GitHub Repository 拥有独立的文档、分段和检索配置。"
        actions={
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent-hover"
          >
            <GitBranch className="h-4 w-4" /> 连接仓库
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-white px-3 shadow-xs transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
          />
        </div>
        {!loading ? <span className="text-xs text-slate-500">共 {visible.length} 个项目</span> : null}
      </div>

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
          <span>{error}</span>
        </div>
      ) : null}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" /> 正在读取知识库...
        </div>
      ) : null}

      {!loading && !visible.length ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-accent-line bg-accent-soft text-indigo-600">
            <BookOpen className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold tracking-tight text-ink">{query ? "没有匹配的项目" : "先连接一个 GitHub 仓库"}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            {query ? "换个名称或描述试试。" : "Repository 是 RAG 的项目边界。连接仓库后，再上传 Markdown、PDF、DOCX 等项目资料。"}
          </p>
          {!query ? (
            <Link
              href="/"
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium text-indigo-700 transition-colors hover:bg-accent-soft"
            >
              连接仓库 <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <Link
              key={item.id}
              href={`/knowledge/${item.id}${openQuestions ? "?tab=qa" : ""}`}
              className="group flex flex-col rounded-xl border border-line bg-white p-5 shadow-xs transition-colors hover:border-indigo-200 hover:bg-indigo-50/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-accent-line bg-accent-soft text-indigo-600">
                    <BookOpen className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-ink">{item.name}</h2>
                    <p className="mt-0.5 text-xs text-slate-400">更新于 {formatDate(item.updated_at)}</p>
                  </div>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
              </div>
              <p className="mb-4 mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">{item.description || "暂无描述"}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-slate-400" /> {formatNumber(item.document_count)} 文档
                </span>
                <span>{formatNumber(item.chunk_count)} 分段</span>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    item.runtime.embedding.available
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${item.runtime.embedding.available ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {item.runtime.embedding.available ? "模型就绪" : "降级运行"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
