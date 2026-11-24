"use client";

import { FileText, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MarkdownMessage, MarkdownSource, MarkdownViewSwitch } from "@/components/markdown-content";
import { formatNumber, type KnowledgeChunk } from "@/lib/rag";

export type PreviewFile = { id: string; name: string; filename: string; detail: string; endpoint: string };

export type FilePreview = { file: PreviewFile } & (
  | { status: "loading" }
  | { status: "ready"; chunks: KnowledgeChunk[] }
  | { status: "error"; message: string }
);

export function IndexedFilePreview({ preview, onClose, onRetry }: {
  preview: FilePreview;
  onClose: () => void;
  onRetry: () => void;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const [showSource, setShowSource] = useState(false);
  const isMarkdown = /\.(?:md|markdown)$/i.test(preview.file.filename);

  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={drawer}
      aria-labelledby="file-preview-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="markdown-document fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-3xl overflow-y-auto overscroll-y-contain border-l border-line bg-panel text-ink shadow-pop backdrop:bg-ink/30"
    >
      <header className="sticky top-0 z-10 border-b border-line bg-white px-4 py-3 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <FileText aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="file-preview-title" title={preview.file.name} className="truncate text-base font-semibold">{preview.file.name}</h2>
            <p className="break-words text-xs leading-5 text-slate-500">{preview.file.detail}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭预览" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <MarkdownViewSwitch label="分段显示方式" showSource={showSource} onChange={setShowSource} />
          {showSource && <span className="text-xs text-slate-500">索引分段原文</span>}
        </div>
      </header>
      <div className="space-y-3 p-4 sm:p-6">
        {preview.status === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取分段…</p>}
        {preview.status === "error" && (
          <div role="alert" className="rounded-lg border border-rose-200 bg-white p-4 text-sm text-rose-700">
            <p>{preview.message}</p>
            <button type="button" onClick={onRetry} className="mt-2 underline">重新读取</button>
          </div>
        )}
        {preview.status === "ready" && (preview.chunks.length ? preview.chunks.map((chunk) => (
          <article key={chunk.id} className="min-w-0 rounded-lg border border-line bg-white p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-line pb-3">
              <h3 className="min-w-0 break-words text-xs font-semibold text-accent">分段 {chunk.position} · {chunk.title}</h3>
              <span className="shrink-0 text-xs text-slate-500">{formatNumber(chunk.character_count)} 字符</span>
            </div>
            {showSource ? (
              <MarkdownSource content={chunk.content} label={`分段 ${chunk.position} 源码`} />
            ) : isMarkdown ? (
              <div className="text-sm leading-6 text-slate-700"><MarkdownMessage content={chunk.content} /></div>
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{chunk.content}</p>
            )}
          </article>
        )) : <p className="text-sm text-slate-500">这个文件暂时没有分段。</p>)}
      </div>
    </dialog>
  );
}
