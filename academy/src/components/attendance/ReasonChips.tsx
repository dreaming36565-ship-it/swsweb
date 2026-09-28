"use client";

// 결석 사유 빠른 선택 — 고르면 인정 / 개인사유 구분이 저절로 정해진다 (보강 관리와 같은 목록).
// 목록에 없는 사유는 직접 적으면 「판정 필요」 → 관리자가 정한다.

import { REASONS } from "@/lib/makeup";
import type { AbsenceCat } from "@/lib/types";

export default function ReasonChips({
  value,
  onPick,
  size = "sm",
}: {
  value: string;
  onPick: (reason: string, cat: AbsenceCat) => void;
  size?: "sm" | "xs";
}) {
  const chip = (r: string, cat: AbsenceCat) => {
    const on = value === r;
    const tone = cat === "OK" ? "border-ok-soft text-ok" : "border-alert-soft text-alert";
    return (
      <button
        key={r}
        type="button"
        onClick={() => onPick(r, cat)}
        className={`rounded-full border px-2 py-0.5 font-bold ${size === "xs" ? "text-[11px]" : "text-xs"} ${
          on ? "border-navy-800 bg-navy-800 text-white" : `bg-white ${tone} hover:bg-navy-50`
        }`}
      >
        {r}
      </button>
    );
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted">인정</span>
      {REASONS.OK.map((r) => chip(r, "OK"))}
      <span className="ml-1 text-[11px] text-muted">개인사유</span>
      {REASONS.PERSONAL.map((r) => chip(r, "PERSONAL"))}
    </div>
  );
}
