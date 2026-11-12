"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const navItems = [
  { href: "/", label: "Workspace" },
  { href: "/knowledge", label: "项目知识" },
  { href: "/rag", label: "RAG 工作室" },
  { href: "/repos", label: "Repos" },
  { href: "/action-drafts", label: "Drafts" },
  { href: "/workflow-runs", label: "Runs" },
  { href: "/workspaces", label: "Reports" },
  { href: "/code-graph", label: "Code Graph" },
  { href: "/evals", label: "RAG 评测" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen text-ink">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-1.5 px-4">
          <Link href="/" className="mr-3 flex shrink-0 items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-[13px] font-bold text-white shadow-xs">
              RL
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:block">RepoLens AI</span>
          </Link>
          <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {navItems.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-accent-soft text-indigo-700"
                      : "text-slate-500 hover:bg-slate-100/80 hover:text-ink"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1600px] p-3">{children}</div>
    </main>
  );
}
