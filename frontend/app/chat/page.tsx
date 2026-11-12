"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Send, Sparkles } from "lucide-react";

import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { apiGet, apiPostStream } from "@/lib/api";
import type { Repository } from "@/lib/types";

const samples = [
  "Why did the latest CI fail?",
  "Summarize the risk in the latest PR",
  "Who should own the latest Issue?",
  "Generate this week's engineering report",
  "Read backend/app/services/agents/chat_agent.py and explain tool calling",
];

const fieldClass =
  "mt-2 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function ChatPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [message, setMessage] = useState("Why did the latest CI fail?");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos").then((items) => {
      setRepos(items);
      setRepoId((current) => current || items[0]?.id || "");
    });
  }, []);

  async function send() {
    setLoading(true);
    setResult("");
    try {
      await apiPostStream("/api/chat/stream", { repo_id: repoId, message, context: { time_range: "7d", messages: [] } }, (event, rawData) => {
        if (event === "delta") {
          const data = rawData as { content?: string };
          if (data.content) setResult((current) => current + data.content);
        }
        if (event === "final") {
          setResult(JSON.stringify(rawData, null, 2));
        }
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Agent Chat"
        description="Use native tool calling to inspect code, search memory, run specialized analysis, and draft safe actions."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="self-start">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <MessageSquare className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">会话</h2>
          </div>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            仓库
            <select className={`${fieldClass} h-10`} value={repoId} onChange={(event) => setRepoId(event.target.value)}>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>{repo.full_name}</option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            问题
            <textarea
              className="mt-2 h-32 w-full resize-y rounded-md border border-line bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={send} disabled={loading || !repoId || !message.trim()}>
              <Send className="h-4 w-4" />
              {loading ? "Analyzing..." : "Ask Agent"}
            </PrimaryButton>
          </div>

          {result && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Sparkles className="h-3.5 w-3.5" />
                Agent 输出
              </div>
              <pre className="max-h-[520px] overflow-auto rounded-lg border border-line bg-panel p-4 font-mono text-xs leading-6 text-slate-700">{result}</pre>
            </div>
          )}
        </Card>

        <Card className="self-start">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-indigo-600">
              <Sparkles className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">示例问题</h2>
          </div>
          <div className="mt-4 grid gap-2">
            {samples.map((sample) => (
              <button
                key={sample}
                onClick={() => setMessage(sample)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  message === sample
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-line bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700"
                }`}
              >
                {sample}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
