"use client";

// 업무 지시 — 내 업무 체크리스트 + 관리자 지시 발송/전체 현황

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { IconTrash } from "./Icons";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { ROLE_LABEL, type SessionUser, type StaffUser, type Task } from "@/lib/types";

type Payload = { tasks: Task[]; users: StaffUser[] };

export default function TasksClient({ user }: { user: SessionUser }) {
  const confirm = useConfirm();
  const isAdmin = user.role === "ADMIN";

  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [data, setData] = useState<Payload | null>(null);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Payload>(`/api/tasks?scope=${isAdmin ? scope : "mine"}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [scope, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      await apiPost("/api/tasks", { assigneeId, title, dueDate: dueDate || null });
      setTitle("");
      setDueDate("");
    });

  const remove = async (t: Task) => {
    const yes = await confirm({
      title: "업무를 삭제할까요?",
      message: t.title,
      confirmText: "삭제",
      danger: true,
    });
    if (yes) void run(() => apiDelete("/api/tasks", { id: t.id }));
  };

  const tasks = data?.tasks ?? [];

  return (
    <div className="w-full space-y-4">
      {isAdmin ? (
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">업무 지시</h2>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <label className="label">업무 내용</label>
              <input
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예) 학부모 상담 자료 준비"
              />
            </div>
            <div className="w-44">
              <label className="label">담당자</label>
              <select
                className="field"
                value={assigneeId ?? ""}
                onChange={(e) => setAssigneeId(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">선택</option>
                {(data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({ROLE_LABEL[u.role]})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className="label">기한</label>
              <input type="date" className="field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
              지시 보내기
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-alert bg-alert-soft px-5 py-3 text-sm font-semibold text-alert">
          {error}
        </div>
      ) : null}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-bold text-ink">{scope === "all" ? "전체 업무" : "내 업무"}</h2>
          {isAdmin ? (
            <div className="flex gap-1">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                    scope === s ? "bg-navy-800 text-white" : "text-muted hover:bg-navy-50"
                  }`}
                >
                  {s === "mine" ? "내 업무" : "전체"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="divide-y divide-line">
          {tasks.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted">업무가 없습니다.</div>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-navy-800)]"
                  checked={t.done === 1}
                  disabled={!isAdmin && t.assigneeId !== user.id}
                  onChange={() => void run(() => apiPatch("/api/tasks", { id: t.id, done: t.done !== 1 }))}
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${t.done === 1 ? "text-muted line-through" : "text-ink"}`}>
                    {t.title}
                  </div>
                  <div className="text-xs text-muted">
                    {t.assigneeName} · {t.createdByName ? `${t.createdByName} 지시` : "지시자 없음"}
                    {t.dueDate ? ` · ${t.dueDate} 까지` : ""}
                  </div>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1 text-alert"
                    onClick={() => void remove(t)}
                    aria-label="삭제"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
