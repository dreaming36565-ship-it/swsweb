"use client";

import type { ReactNode } from "react";
import { IconVolume } from "../Icons";

/**
 * 출결 팝업 2종(출석체크 · 출결전화)이 공유하는 틀 — 큰 제목 + 설명 + 하단 버튼.
 * 「접기」로 팝업을 잠깐 내려 둘 수 있다(입력한 내용은 그대로).
 * 접어 두면 화면 위쪽에 깜박이는 띠가 남는다 — 이 띠는 끝까지 처리해야 사라진다.
 */
export default function PopupFrame({
  heading,
  subtitle,
  note,
  muted,
  onToggleMute,
  folded,
  onToggleFold,
  foldLabel,
  error,
  children,
  footer,
}: {
  heading: string;
  subtitle: ReactNode;
  note?: ReactNode;
  muted: boolean;
  onToggleMute: () => void;
  folded: boolean;
  onToggleFold: () => void;
  /** 접었을 때 띠에 보일 짧은 말 (예: 오후 2:42 · 3개 반) */
  foldLabel: string;
  error?: string | null;
  children: ReactNode;
  footer: ReactNode;
}) {
  const muteBtn = (cls: string) => (
    <button type="button" className={`btn ${muted ? "btn-ghost" : ""} ${cls}`} onClick={onToggleMute} title="이 팝업의 알림음만 켜고 끕니다">
      <IconVolume className="h-4 w-4" />
      {muted ? "소리 꺼짐" : "소리 켜짐"}
    </button>
  );
  return (
    <>
      {folded ? (
        <div className="fixed left-1/2 top-3 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 text-white shadow-lg blink-alert print:hidden">
          <b className="text-[15px]">🔔 {heading}</b>
          <span className="text-sm opacity-90">{foldLabel}</span>
          {muteBtn("shrink-0 py-1 text-xs")}
          <button type="button" className="btn shrink-0 bg-white py-1 font-bold text-navy-900" onClick={onToggleFold}>
            열기
          </button>
        </div>
      ) : null}
      <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/45 p-6 fade-in print:hidden ${folded ? "hidden" : ""}`}>
        <div className="card pop-in flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-5">
            <div>
              <h2 className="text-2xl font-bold text-navy-900">{heading}</h2>
              <div className="mt-2 text-sm text-muted">{subtitle}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {muteBtn("")}
              <button type="button" className="btn" onClick={onToggleFold} title="잠깐 내려 두기 — 입력한 내용은 그대로, 위쪽 띠가 깜박여요">
                접기
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-7 py-5">{children}</div>

          {error ? <div className="border-t border-line bg-alert-soft px-7 py-3 text-sm font-semibold text-alert">{error}</div> : null}

          <div className="flex items-center justify-between gap-4 border-t border-line bg-navy-50 px-7 py-4">
            <div className="text-sm text-navy-700">{note}</div>
            <div className="flex shrink-0 items-center gap-2">{footer}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/** "데스크" / "최나영T" 같은 받는 사람 표시 */
export function WhoBadge({ children }: { children: ReactNode }) {
  return <span className="mr-2 inline-block rounded-md bg-navy-100 px-2 py-0.5 text-xs font-bold text-navy-800">{children}</span>;
}
