"use client";

import type { ReactNode } from "react";
import { IconVolume } from "../Icons";
import { rangeLabel } from "@/lib/time";
import { DAY_LABELS } from "@/lib/time";
import type { AttendanceEvent } from "@/lib/types";

/** 출결 팝업 3종이 공유하는 틀 — 큰 제목 + 수업 정보 + 하단 버튼 */
export default function PopupFrame({
  event,
  heading,
  note,
  muted,
  onToggleMute,
  showMute = true,
  error,
  children,
  footer,
}: {
  event: AttendanceEvent;
  heading: string;
  note?: string;
  muted?: boolean;
  onToggleMute?: () => void;
  showMute?: boolean;
  error?: string | null;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/45 p-6 fade-in">
      <div className="card pop-in flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-bold text-navy-900">{heading}</h2>
            <p className="mt-2 text-sm text-muted">
              {event.className} 수업 · {DAY_LABELS[event.dayOfWeek]}요일{" "}
              {rangeLabel(event.startMin, event.endMin)}
              {event.teacherName ? ` · 담당: ${event.teacherName} 선생님` : ""}
              {event.roomName ? ` · ${event.roomName}` : ""}
            </p>
          </div>
          {showMute && onToggleMute ? (
            <button
              type="button"
              className={`btn ${muted ? "btn-ghost" : ""} shrink-0`}
              onClick={onToggleMute}
              title="이 팝업의 알림음만 끕니다"
            >
              <IconVolume className="h-4 w-4" />
              {muted ? "알림 꺼짐" : "1분마다 알림"}
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-auto px-7 py-5">{children}</div>

        {error ? (
          <div className="border-t border-line bg-alert-soft px-7 py-3 text-sm font-semibold text-alert">
            {error}
          </div>
        ) : null}

        {note ? (
          <div className="border-t border-line bg-navy-50 px-7 py-3 text-sm text-navy-700">{note}</div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-line bg-white px-7 py-4">
          {footer}
        </div>
      </div>
    </div>
  );
}
