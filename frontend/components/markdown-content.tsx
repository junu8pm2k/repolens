"use client";

import { Code2, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="markdown-table-wrap">
              <table {...props}>{children}</table>
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const markdownViews = [
  { source: false, label: "预览", icon: Eye },
  { source: true, label: "源码", icon: Code2 }
];

export function MarkdownViewSwitch({ label, showSource, onChange }: {
  label: string;
  showSource: boolean;
  onChange: (source: boolean) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5">
      {markdownViews.map(({ source, label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          aria-pressed={showSource === source}
          onClick={() => onChange(source)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-slate-600 transition hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-white aria-pressed:text-accent aria-pressed:shadow-xs"
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function MarkdownSource({ content, label = "Markdown 源码" }: { content: string; label?: string }) {
  return (
    <pre aria-label={label} tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-panel p-3 text-xs leading-6 text-slate-700">
      <code>{content}</code>
    </pre>
  );
}
