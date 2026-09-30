"use client";

// 알림 & 공지 — 공지 목록(관리자 작성) + 내 알림 기록

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { IconTrash } from "./Icons";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { DEPARTMENTS, type Department, type Notice, type Notification, type SessionUser } from "@/lib/types";

export default function NoticesClient({ user }: { user: SessionUser }) {
  const canWrite = user.roles.includes("ADMIN");
  const confirm = useConfirm();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"ALL" | Department>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 고치는 중인 공지 */
  const [edit, setEdit] = useState<{ id: number; title: string; body: string; department: "ALL" | Department; error: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [n, notif] = await Promise.all([
        apiGet<{ notices: Notice[] }>("/api/notices?dept=ALL"),
        apiGet<{ items: Notification[] }>("/api/notifications"),
      ]);
      setNotices(n.notices);
      setNotifications(notif.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/notices", { title, body, department: target });
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    try {
      await apiPatch("/api/notices", { id: edit.id, title: edit.title, body: edit.body, department: edit.department });
      setEdit(null);
      await load();
    } catch (e) {
      setEdit({ ...edit, error: errorMessage(e) });
    }
  };

  const remove = async (n: Notice) => {
    const yes = await confirm({ title: "공지를 지울까요?", message: n.title, confirmText: "지우기", danger: true });
    if (!yes) return;
    setError(null);
    try {
      await apiDelete("/api/notices", { id: n.id });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="w-full space-y-4">
      {canWrite ? (
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">공지 작성</h2>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className="label">제목</label>
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="w-36">
              <label className="label">대상</label>
              <select
                className="field"
                value={target}
                onChange={(e) => setTarget(e.target.value as "ALL" | Department)}
              >
                <option value="ALL">전체</option>
                <option value="ELEM">초중등부</option>
                <option value="HIGH">고등부</option>
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="label">내용</label>
            <textarea
              className="field min-h-24"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {error ? (
            <div className="mt-3 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
              {error}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
              공지 등록
            </button>
          </div>
        </section>
      ) : null}

      {error && !canWrite ? (
        <div className="rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">{error}</div>
      ) : null}
      <div className="flex w-full gap-4">
        <section className="card min-w-0 flex-1 p-5">
          <h2 className="text-base font-bold text-ink">공지</h2>
          <div className="mt-4 space-y-3">
            {notices.length === 0 ? (
              <p className="text-sm text-muted">등록된 공지가 없습니다.</p>
            ) : (
              notices.map((n) =>
                edit?.id === n.id ? (
                <article key={n.id} className="rounded-lg border-2 border-navy-300 p-4">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[200px] flex-1">
                      <label className="label">제목</label>
                      <input className="field" value={edit.title} autoFocus onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
                    </div>
                    <div className="w-32">
                      <label className="label">대상</label>
                      <select className="field" value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value as "ALL" | Department })}>
                        <option value="ALL">전체</option>
                        <option value="ELEM">초중등부</option>
                        <option value="HIGH">고등부</option>
                      </select>
                    </div>
                  </div>
                  <label className="label mt-2">내용</label>
                  <textarea className="field min-h-24" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
                  {edit.error ? <div className="mt-2 text-sm font-semibold text-alert">{edit.error}</div> : null}
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button type="button" className="btn" onClick={() => setEdit(null)}>
                      취소
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => void saveEdit()}>
                      저장
                    </button>
                  </div>
                </article>
                ) : (
                <article key={n.id} className="rounded-lg border border-line p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-ink">{n.title}</h3>
                    <span className="rounded border border-line bg-navy-50 px-1.5 py-0.5 text-[11px] text-muted">
                      {n.department === "ALL" ? "전체" : DEPARTMENTS[n.department as Department].dept}
                    </span>
                    {canWrite ? (
                      <button
                        type="button"
                        className="btn btn-ghost ml-auto px-2 py-1 text-xs"
                        onClick={() => setEdit({ id: n.id, title: n.title, body: n.body, department: (n.department as "ALL" | Department) ?? "ALL", error: null })}
                        title="공지 고치기"
                      >
                        ✏️ 고치기
                      </button>
                    ) : null}
                    {canWrite ? (
                      <button type="button" className="btn btn-ghost px-2 py-1 text-alert" onClick={() => void remove(n)} aria-label="공지 지우기" title="공지 지우기">
                        <IconTrash className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{n.body}</p>
                  <div className="mt-2 text-xs text-muted">
                    {n.authorName ?? "관리자"} · {new Date(n.createdAt).toLocaleString("ko-KR")}
                  </div>
                </article>
                ),
              )
            )}
          </div>
        </section>

        <aside className="card w-[340px] shrink-0 self-start p-5">
          <h2 className="text-base font-bold text-ink">내 알림</h2>
          <div className="mt-4 space-y-2">
            {notifications.length === 0 ? (
              <p className="text-sm text-muted">알림이 없습니다.</p>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="border-b border-line pb-2 last:border-b-0">
                  <div className="text-sm font-semibold text-ink">{n.title}</div>
                  {n.body ? <div className="text-xs text-muted">{n.body}</div> : null}
                  <div className="mt-0.5 text-[11px] text-muted">
                    {new Date(n.createdAt).toLocaleString("ko-KR")}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
