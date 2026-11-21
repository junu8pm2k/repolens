"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Card, PrimaryButton } from "@/components/ui/card";
import type { TeamMember } from "@/lib/types";

type Profile = Omit<TeamMember, "id">;

const emptyProfile: Profile = { name: "", role: "", strengths: "", techStack: "" };
const fieldClass = "mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export function AssigneeSettings({
  members,
  loading,
  loadError,
  onSave,
  onRemove,
  onRetry
}: {
  members: TeamMember[];
  loading: boolean;
  loadError: string | null;
  onSave: (profile: Profile) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [profile, setProfile] = useState(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = profile.name.trim();
    if (!name || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        name,
        role: profile.role.trim(),
        strengths: profile.strengths.trim(),
        techStack: profile.techStack.trim()
      });
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
      await onRemove(memberId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移除成员失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {loadError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p role="alert">{loadError}</p>
          <button type="button" onClick={onRetry} className="mt-1 font-medium underline">重新读取成员</button>
        </div>
      )}
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" /> 正在读取成员资料…
        </p>
      ) : (
        <div className="space-y-3">
          <Card>
            <h3 className="text-base font-semibold text-ink">负责人推荐</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">为未分配的 Issue 提供候选人，供人工分派时参考。</p>
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
              <h3 className="text-sm font-semibold text-ink">候选成员</h3>
              <span className="text-sm text-slate-500">{members.length} 人</span>
            </div>
            {members.length === 0 ? (
              <p className="mt-3 rounded-lg bg-panel px-3 py-2 text-sm text-slate-500">当前仓库还没有候选成员。</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {members.map((member) => (
                  <li key={member.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1 break-words text-sm text-slate-600">
                      <h4 className="font-medium text-ink">{member.name}</h4>
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
    </div>
  );
}
