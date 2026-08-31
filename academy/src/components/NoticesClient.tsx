"use client";

// 알림 & 공지 — 공지 목록(관리자 작성) + 내 알림 기록

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { DEPARTMENTS, type Department, type Notice, type Notification, type SessionUser } from "@/lib/types";

export default function NoticesClient({ user }: { user: SessionUser }) {
  const canWrite = user.role === "ADMIN";
  const [notices, setNotices] = useState<Notice[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"ALL" | Department>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

      <div className="flex w-full gap-4">
        <section className="card min-w-0 flex-1 p-5">
          <h2 className="text-base font-bold text-ink">공지</h2>
          <div className="mt-4 space-y-3">
            {notices.length === 0 ? (
              <p className="text-sm text-muted">등록된 공지가 없습니다.</p>
            ) : (
              notices.map((n) => (
                <article key={n.id} className="rounded-lg border border-line p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-ink">{n.title}</h3>
                    <span className="rounded border border-line bg-navy-50 px-1.5 py-0.5 text-[11px] text-muted">
                      {n.department === "ALL" ? "전체" : DEPARTMENTS[n.department as Department].dept}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{n.body}</p>
                  <div className="mt-2 text-xs text-muted">
                    {n.authorName ?? "관리자"} · {new Date(n.createdAt).toLocaleString("ko-KR")}
                  </div>
                </article>
              ))
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
