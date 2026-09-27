"use client";

import type { ReactNode } from "react";
import { IconVolume } from "../Icons";

/**
 * 출결 팝업 2종(출석체크 · 출결전화)이 공유하는 틀 — 큰 제목 + 설명 + 하단 버튼.
 * 닫기/나중에 버튼이 없다. 끝까지 처리해야 사라진다.
 */
export default function PopupFrame({
  heading,
  subtitle,
  note,
  muted,
  onToggleMute,
  error,
  children,
  footer,
}: {
  heading: string;
  subtitle: ReactNode;
  note?: ReactNode;
  muted: boolean;
  onToggleMute: () => void;
  error?: string | null;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/45 p-6 fade-in">
      <div className="card pop-in flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-bold text-navy-900">{heading}</h2>
            <div className="mt-2 text-sm text-muted">{subtitle}</div>
          </div>
          <button
            type="button"
            className={`btn ${muted ? "btn-ghost" : ""} shrink-0`}
            onClick={onToggleMute}
            title="이 팝업의 알림음만 끕니다"
          >
            <IconVolume className="h-4 w-4" />
            {muted ? "알림 꺼짐" : "1분마다 알림"}
          </button>
        </div>

        <div className="flex-1 overflow-auto px-7 py-5">{children}</div>

        {error ? (
          <div className="border-t border-line bg-alert-soft px-7 py-3 text-sm font-semibold text-alert">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4 border-t border-line bg-navy-50 px-7 py-4">
          <div className="text-sm text-navy-700">{note}</div>
          <div className="flex shrink-0 items-center gap-2">{footer}</div>
        </div>
      </div>
    </div>
  );
}

/** "데스크" / "최나영T" 같은 받는 사람 표시 */
export function WhoBadge({ children }: { children: ReactNode }) {
  return (
    <span className="mr-2 inline-block rounded-md bg-navy-100 px-2 py-0.5 text-xs font-bold text-navy-800">
      {children}
    </span>
  );
}
