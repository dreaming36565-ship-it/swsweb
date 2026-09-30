"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconBell } from "./Icons";
import ResultTable from "./attendance/ResultTable";
import { TrashButton, usePurge } from "./Purge";
import { can } from "@/lib/perm";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { showDesktop } from "@/lib/desktopNotify";
import type { AttendanceEvent, Notification, SessionUser } from "@/lib/types";

/** 알림함에 오면 윈도우 알림창도 띄우는 알림 — ⏰ 선생님 출석체크 5분 넘게 안 됨(데스크) */
const DESKTOP_KINDS = ["ATTENDANCE_LATE_CHECK"];

type Payload = { items: Notification[]; unread: number };

/** 알림 링크에 담긴 출결 id 목록 — "/attendance?date=...&events=3,4" */
function eventIdsOf(n: Notification): string | null {
  if (n.kind !== "ATTENDANCE_RESULT" || !n.link) return null;
  const q = n.link.split("?")[1] ?? "";
  return new URLSearchParams(q).get("events");
}

/**
 * 상단 알림 종 — 8초 폴링.
 * 출결 결과(지각·결석)는 팝업 없이 여기로만 온다. 알림을 누르면 결과 표가 펼쳐진다
 * (그 사이 나중에 도착한 학생은 지각으로 바뀌어 보인다 — 매번 최신으로 불러온다).
 */
export default function NotificationBell({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<AttendanceEvent[] | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // 🗑 내 알림 한 개 지우기 (관리자)
  const canPurge = can(user, "records.purge");
  const purge = usePurge();
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const purging = useRef(false);

  /** 이미 본(또는 처음 불러올 때 있던) 알림 — 새로 온 것만 알림창으로 */
  const known = useRef<Set<number> | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await apiGet<Payload>("/api/notifications");
      if (known.current) {
        for (const n of data.items) {
          if (known.current.has(n.id) || n.readAt || !DESKTOP_KINDS.includes(n.kind)) continue;
          showDesktop({ tag: `noti-${n.id}`, title: n.title, body: n.body ?? "", onClick: () => setOpen(true) });
        }
      }
      known.current = new Set(data.items.map((n) => n.id));
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* 알림은 조용히 재시도한다 — 화면을 막지 않는다 */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // 🗑 확인창을 누르는 동안에는 닫지 않는다
      if (purging.current) return;
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) setExpanded(null);
    if (next && unread > 0) {
      try {
        await apiPost("/api/notifications", { action: "readAll" });
        setUnread(0);
      } catch {
        /* 읽음 처리 실패는 다음 폴링에서 회복된다 */
      }
    }
  };

  const expand = async (n: Notification) => {
    if (expanded === n.id) {
      setExpanded(null);
      return;
    }
    const ids = eventIdsOf(n);
    if (!ids) return;
    setExpanded(n.id);
    setDetail(null);
    setDetailError(null);
    try {
      const data = await apiGet<{ events: AttendanceEvent[] }>(`/api/attendance/list?events=${ids}`);
      setDetail(data.events);
    } catch (e) {
      setDetailError(errorMessage(e));
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        className="btn btn-ghost relative px-2 py-2"
        onClick={() => void toggle()}
        aria-label="알림"
      >
        <IconBell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className={`absolute right-0 z-40 mt-2 overflow-hidden rounded-xl border border-line bg-white shadow-lg pop-in ${
            expanded !== null ? "w-[680px]" : "w-96"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-bold text-ink">알림</span>
            <Link href="/notices" className="text-xs text-navy-600 hover:underline" onClick={() => setOpen(false)}>
              전체 보기
            </Link>
          </div>
          {purgeError ? (
            <div className="flex items-center justify-between gap-2 border-b border-line bg-alert-soft px-4 py-2 text-xs font-semibold text-alert">
              <span>{purgeError}</span>
              <button type="button" className="btn btn-ghost px-1.5 py-0 text-xs" onClick={() => setPurgeError(null)}>
                닫기
              </button>
            </div>
          ) : null}
          <div className="max-h-[70vh] overflow-auto">
            {items.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">알림이 없습니다.</div>
            ) : (
              items.map((n) => {
                const canExpand = eventIdsOf(n) !== null;
                const isOpen = expanded === n.id;
                return (
                  <div key={n.id} className="relative border-b border-line last:border-b-0">
                    {canPurge ? (
                      <span className="absolute bottom-2 right-3 z-10">
                        <TrashButton
                          title="알림 지우기 (관리자)"
                          onClick={() => {
                            setPurgeError(null);
                            purging.current = true;
                            purge([{ kind: "NOTIF", id: n.id }])
                              .finally(() => {
                                // 확인창 버튼의 mousedown 이 끝난 뒤에 풀어 준다
                                setTimeout(() => (purging.current = false), 0);
                              })
                              .then((done) => {
                                if (done) {
                                  if (expanded === n.id) setExpanded(null);
                                  void load();
                                }
                              })
                              .catch((e) => setPurgeError(errorMessage(e)));
                          }}
                        />
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={`block w-full px-4 py-2.5 text-left ${canExpand ? "hover:bg-navy-50" : "cursor-default"} ${
                        n.readAt === null ? "bg-navy-50/60" : ""
                      }`}
                      onClick={() => canExpand && void expand(n)}
                    >
                      <div className="flex items-center gap-2">
                        {n.readAt === null ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-alert" /> : null}
                        <span className="text-sm font-semibold text-ink">{n.title}</span>
                        {canExpand ? (
                          <span className="ml-auto text-[11px] text-navy-600">{isOpen ? "접기 ▲" : "자세히 ▼"}</span>
                        ) : null}
                      </div>
                      {n.body ? <div className="mt-0.5 text-xs text-muted">{n.body}</div> : null}
                      <div className="mt-1 text-[11px] text-muted">
                        {new Date(n.createdAt).toLocaleString("ko-KR")}
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="border-t border-line px-4 py-3">
                        {detailError ? (
                          <p className="text-sm font-semibold text-alert">{detailError}</p>
                        ) : detail === null ? (
                          <p className="text-sm text-muted">불러오는 중…</p>
                        ) : (
                          <ResultTable events={detail} showClass={user.roles.includes("ADMIN") || detail.length > 1} />
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
