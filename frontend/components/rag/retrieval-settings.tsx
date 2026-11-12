"use client";

import { Check, FileSearch, Layers3, Search } from "lucide-react";

import type { KnowledgeConfig, ModelCatalog, RetrievalMethod } from "@/lib/rag";

type Props = {
  value: KnowledgeConfig;
  catalog: ModelCatalog | null;
  onChange: (value: KnowledgeConfig) => void;
  showChunking?: boolean;
};

const methods: { value: RetrievalMethod; label: string; note: string; icon: typeof Search }[] = [
  { value: "vector", label: "向量检索", note: "擅长理解语义相近的表达", icon: Layers3 },
  { value: "fulltext", label: "全文检索", note: "适合专有名词与精确关键词", icon: FileSearch },
  { value: "hybrid", label: "混合检索", note: "融合语义与关键词结果", icon: Search }
];

const fieldClass =
  "mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export function RetrievalSettings({ value, catalog, onChange, showChunking = true }: Props) {
  const update = <K extends keyof KnowledgeConfig,>(key: K, next: KnowledgeConfig[K]) => onChange({ ...value, [key]: next });

  return (
    <div className="space-y-6">
      {showChunking ? (
        <section>
          <h3 className="text-sm font-semibold tracking-tight text-ink">分段设置</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">按自然段落切分，过长段落会继续按长度拆开。</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">
              最大分段长度
              <input
                type="number"
                min={200}
                max={4000}
                value={value.chunk_size}
                onChange={(event) => update("chunk_size", Number(event.target.value))}
                className={fieldClass}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              分段重叠长度
              <input
                type="number"
                min={0}
                max={1000}
                value={value.chunk_overlap}
                onChange={(event) => update("chunk_overlap", Number(event.target.value))}
                className={fieldClass}
              />
            </label>
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="text-sm font-semibold tracking-tight text-ink">索引方式</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">DeepSeek 官方 API 暂无 Embedding，默认使用 Qwen。</p>
        <label className="mt-3 block text-xs font-medium text-slate-600">
          Embedding 模型
          <select
            value={`${value.embedding_provider}::${value.embedding_model}`}
            onChange={(event) => {
              const [provider, model] = event.target.value.split("::");
              const selected = catalog?.embedding_models.find((item) => item.provider === provider && item.model === model);
              onChange({ ...value, embedding_provider: provider, embedding_model: model, embedding_dimensions: selected?.dimensions ?? value.embedding_dimensions });
            }}
            className={fieldClass}
          >
            {(catalog?.embedding_models ?? []).map((model) => (
              <option key={`${model.provider}-${model.model}`} value={`${model.provider}::${model.model}`}>
                {model.label}{model.available ? "" : " · 未配置，自动降级"}
              </option>
            ))}
            {!catalog ? <option value={`${value.embedding_provider}::${value.embedding_model}`}>{value.embedding_model}</option> : null}
          </select>
        </label>
      </section>

      <section>
        <h3 className="text-sm font-semibold tracking-tight text-ink">检索设置</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {methods.map((method) => {
            const Icon = method.icon;
            const selected = value.retrieval_method === method.value;
            return (
              <button
                key={method.value}
                type="button"
                onClick={() => update("retrieval_method", method.value)}
                className={`relative flex min-h-32 flex-col rounded-lg border p-3 text-left transition-colors ${selected ? "border-indigo-300 bg-accent-soft/70" : "border-line bg-white hover:border-indigo-200 hover:bg-indigo-50/40"}`}
              >
                {selected ? (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-accent text-white">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
                <Icon className={`h-5 w-5 ${selected ? "text-indigo-600" : "text-slate-400"}`} />
                <span className={`mt-3 block text-sm font-medium ${selected ? "text-indigo-700" : "text-ink"}`}>{method.label}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{method.note}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-ink">Rerank 模型</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">对召回候选重新排序，API 不可用时自动使用本地重排。</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={value.rerank_enabled}
            aria-label="启用 Rerank"
            onClick={() => update("rerank_enabled", !value.rerank_enabled)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2 ${value.rerank_enabled ? "bg-accent" : "bg-slate-300"}`}
          >
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-xs transition-all ${value.rerank_enabled ? "left-6" : "left-1"}`} />
          </button>
        </div>
        {value.rerank_enabled ? (
          <select
            value={`${value.rerank_provider}::${value.rerank_model}`}
            onChange={(event) => {
              const [provider, model] = event.target.value.split("::");
              onChange({ ...value, rerank_provider: provider, rerank_model: model });
            }}
            className={fieldClass}
          >
            {(catalog?.rerank_models ?? []).map((model) => (
              <option key={`${model.provider}-${model.model}`} value={`${model.provider}::${model.model}`}>
                {model.label}{model.available ? "" : " · 未配置，自动降级"}
              </option>
            ))}
            {!catalog ? <option value={`${value.rerank_provider}::${value.rerank_model}`}>{value.rerank_model}</option> : null}
          </select>
        ) : null}
      </section>

      <section className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">
          Top K
          <div className="mt-2 flex items-center gap-3">
            <input type="range" min={1} max={10} value={value.top_k} onChange={(event) => update("top_k", Number(event.target.value))} className="min-w-0 flex-1 accent-indigo-600" />
            <input type="number" min={1} max={20} value={value.top_k} onChange={(event) => update("top_k", Number(event.target.value))} className="h-9 w-16 rounded-md border border-line bg-white text-center text-sm text-ink outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
          </div>
        </label>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Score 阈值</span>
            <input type="checkbox" checked={value.score_threshold_enabled} onChange={(event) => update("score_threshold_enabled", event.target.checked)} className="h-4 w-4 accent-indigo-600" />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input type="range" min={0} max={1} step={0.01} disabled={!value.score_threshold_enabled} value={value.score_threshold} onChange={(event) => update("score_threshold", Number(event.target.value))} className="min-w-0 flex-1 accent-indigo-600 disabled:opacity-40" />
            <span className="w-12 text-right text-sm text-slate-600">{value.score_threshold.toFixed(2)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
