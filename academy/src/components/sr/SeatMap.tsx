"use client";

// SR룸 자리표 — A~D 4열 × 6석, 칠판은 아래(1번 줄이 칠판 바로 앞). 시트와 같은 방향.

import type { ReactNode } from "react";
import { SEAT_COLS, SEAT_ROWS, type SeatUse } from "@/lib/sr";
import { clockLabel, rangeLabel } from "@/lib/time";
import type { ClassColor } from "@/lib/colors";

export type SeatMark = { tone: "pick" | "self" | "block"; onClick?: () => void; title?: string; content: ReactNode };

export default function SeatMap({
  occ,
  colors,
  mark,
  now,
  onSeat,
}: {
  occ: Map<string, SeatUse>;
  colors: Map<number, ClassColor>;
  /** 자리 바꾸기 · 임시 자리 고를 때 — 자리마다 표시 */
  mark?: (seat: string, o: SeatUse | undefined) => SeatMark | null;
  /** 지금 시각 — 10분 안에 끝나는 자리에 「곧 끝」 */
  now?: number;
  onSeat?: (o: SeatUse) => void;
}) {
  const rows = Array.from({ length: SEAT_ROWS }, (_, i) => SEAT_ROWS - i);
  return (
    <div>
      <div className="grid grid-cols-4 gap-4">
        {SEAT_COLS.map((col) => (
          <div key={col}>
            {rows.map((r) => {
              const seat = `${col}${r}`;
              const o = occ.get(seat);
              const m = mark?.(seat, o) ?? null;
              const no = <span className="absolute right-2 top-1 text-[10px] font-bold text-muted">{seat}</span>;
              const base = "relative mb-2 block h-[62px] w-full rounded-[10px] border px-2 py-1.5 text-left text-xs";
              if (m) {
                const tone =
                  m.tone === "pick"
                    ? "border-2 border-srpink bg-srpink-soft text-srpink cursor-pointer"
                    : m.tone === "self"
                      ? "border-navy-900 bg-navy-800 text-white"
                      : "border-line bg-navy-50 text-navy-300";
                return (
                  <button key={seat} type="button" className={`${base} ${tone}`} onClick={m.onClick} title={m.title} disabled={!m.onClick}>
                    {no}
                    {m.content}
                  </button>
                );
              }
              if (!o)
                return (
                  <div key={seat} className={`${base} border-line bg-navy-50 text-navy-300`}>
                    {no}
                    <span className="mt-1.5 block text-xs font-semibold">빈자리</span>
                  </div>
                );
              if (o.adhocId) {
                return (
                  <button
                    key={seat}
                    type="button"
                    className={`${base} border-dashed border-navy-400 bg-[repeating-linear-gradient(135deg,#fff,#fff_6px,var(--color-navy-50)_6px,var(--color-navy-50)_12px)]`}
                    onClick={() => onSeat?.(o)}
                    title="임시 자리"
                  >
                    {no}
                    <span className="mt-1.5 block text-sm font-extrabold">{o.name}</span>
                    <span className="text-[11px]">
                      📌 {o.label} {rangeLabel(o.start, o.end)}
                    </span>
                  </button>
                );
              }
              const c = o.classId !== null ? colors.get(o.classId) : undefined;
              const soon = now !== undefined && o.end - now <= 10;
              return (
                <button
                  key={seat}
                  type="button"
                  className={`${base} cursor-pointer`}
                  style={c ? { background: c.bg, borderColor: c.border, color: c.text } : undefined}
                  onClick={() => onSeat?.(o)}
                >
                  {no}
                  <span className="mt-1.5 block text-sm font-extrabold">{o.name}</span>
                  <span className="text-[11px]">
                    {o.label} · ~{clockLabel(o.end)}
                  </span>
                  {soon ? <span className="absolute bottom-1 right-1.5 text-[10px] font-extrabold text-late">곧 끝</span> : null}
                </button>
              );
            })}
            <div className="text-center font-extrabold text-navy-700">{col}열</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 rounded-lg bg-navy-800 py-1.5 text-center font-bold tracking-[4px] text-white">칠 판</div>
    </div>
  );
}
