"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconBell } from "./Icons";
import { apiGet, apiPost } from "@/lib/http";
import type { Notification } from "@/lib/types";

type Payload = { items: Notification[]; unread: number };

/** 상단 알림 종 — 팝업을 닫아도 기록이 여기 남는다. 8초 폴링. */
export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Payload>("/api/notifications");
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
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await apiPost("/api/notifications", { action: "readAll" });
        setUnread(0);
      } catch {
        /* 읽음 처리 실패는 다음 폴링에서 회복된다 */
      }
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
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-white shadow-lg pop-in">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-bold text-ink">알림</span>
            <Link href="/notices" className="text-xs text-navy-600 hover:underline" onClick={() => setOpen(false)}>
              전체 보기
            </Link>
          </div>
          <div className="max-h-80 overflow-auto">
            {items.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">알림이 없습니다.</div>
            ) : (
              items.map((n) => (
                <div key={n.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                  <div className="text-sm font-semibold text-ink">{n.title}</div>
                  {n.body ? <div className="mt-0.5 text-xs text-muted">{n.body}</div> : null}
                  <div className="mt-1 text-[11px] text-muted">
                    {new Date(n.createdAt).toLocaleString("ko-KR")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
