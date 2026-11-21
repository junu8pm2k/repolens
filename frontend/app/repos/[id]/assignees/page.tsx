"use client";

import { ArrowLeft, LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type { Repository, TeamMember } from "@/lib/types";

type Profile = Omit<TeamMember, "id">;

const emptyProfile: Profile = { name: "", role: "", strengths: "", techStack: "" };
const fieldClass = "mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function AssigneeSettingsPage() {
  const { id } = useParams<{ id: string }>();
  return <AssigneeSettings key={id} repoId={id} />;
}

function AssigneeSettings({ repoId }: { repoId: string }) {
  const membersUrl = `/api/repos/${encodeURIComponent(repoId)}/team-members`;
  const [repoName, setRepoName] = useState("");
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    apiGet<Repository[]>("/api/repos")
      .then((repos) => {
        if (!ignore) setRepoName(repos.find((repo) => repo.id === repoId)?.full_name ?? "");
      })
      .catch(() => undefined);
    apiGet<TeamMember[]>(membersUrl)
      .then((items) => { if (!ignore) setMembers(items); })
      .catch((reason: Error) => { if (!ignore) setError(reason.message); });
    return () => { ignore = true; };
  }, [repoId, membersUrl]);

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = profile.name.trim();
    if (!name || saving) return;
    setSaving(true);
    setError("");
    try {
      const member = await apiPost<TeamMember>(membersUrl, {
        name,
        role: profile.role.trim(),
        strengths: profile.strengths.trim(),
        techStack: profile.techStack.trim()
      });
      setMembers((current) => [...(current ?? []).filter((item) => item.id !== member.id), member]);
      setProfile(emptyProfile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存成员失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(memberId: string) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await apiDelete(`${membersUrl}/${encodeURIComponent(memberId)}`);
      setMembers((current) => current?.filter((member) => member.id !== memberId) ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移除成员失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle
        title="负责人推荐"
        description={repoName ? `${repoName} · 为未分配的 Issue 提供候选人，供人工分派时参考。` : "为未分配的 Issue 提供候选人，供人工分派时参考。"}
        actions={
          <Link href="/repos" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-600 hover:bg-panel">
            <ArrowLeft className="h-4 w-4" /> 返回仓库管理
          </Link>
        }
      />

      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {members === null && !error && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" /> 正在读取成员资料…
        </p>
      )}

      {members !== null && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]">
          <Card>
            <h2 className="text-base font-semibold text-ink">添加成员</h2>
            <form onSubmit={saveMember} className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                姓名
                <input required disabled={saving} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} className={fieldClass} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                职位
                <input disabled={saving} value={profile.role} onChange={(event) => setProfile({ ...profile, role: event.target.value })} placeholder="例如：后端工程师" className={fieldClass} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                擅长方向
                <textarea rows={2} disabled={saving} value={profile.strengths} onChange={(event) => setProfile({ ...profile, strengths: event.target.value })} placeholder="例如：鉴权、API 设计" className={fieldClass} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                技术栈
                <input disabled={saving} value={profile.techStack} onChange={(event) => setProfile({ ...profile, techStack: event.target.value })} placeholder="例如：Python、FastAPI" className={fieldClass} />
              </label>
              <PrimaryButton type="submit" disabled={saving || !profile.name.trim()}>
                <Plus className="h-4 w-4" /> 保存成员
              </PrimaryButton>
            </form>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">候选成员</h2>
              <span className="text-sm text-slate-500">{members.length} 人</span>
            </div>
            {members.length === 0 ? (
              <p className="mt-3 rounded-lg bg-panel px-3 py-2 text-sm text-slate-500">当前仓库还没有候选成员。</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {members.map((member) => (
                  <li key={member.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1 break-words text-sm text-slate-600">
                      <h3 className="font-medium text-ink">{member.name}</h3>
                      {member.role && <p>{member.role}</p>}
                      {member.strengths && <p>擅长方向 · {member.strengths}</p>}
                      {member.techStack && <p>技术栈 · {member.techStack}</p>}
                    </div>
                    <button type="button" aria-label={`移除 ${member.name}`} disabled={saving} onClick={() => removeMember(member.id)} className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-slate-600 hover:bg-panel disabled:opacity-50">
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
