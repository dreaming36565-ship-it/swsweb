"use client";

// 시간 격자 — 10분 한 칸. 세로 = 시간, 가로 = 칸(선생님 · 교실). 겹치는 블록은 같은 폭으로 나란히.
// 오늘 요일이면 주황 선 = 지금 시각.

import type { ReactNode } from "react";
import { fmtTime, clockLabel } from "@/lib/time";
import type { ClassColor } from "@/lib/colors";
import { lanes } from "./model";

export type GridBlock = {
  key: string;
  start: number;
  end: number;
  color?: ClassColor | null;
  /** sr = 점선, booking = 빗금 */
  kind: "class" | "sr" | "booking";
  title?: string;
  onClick?: () => void;
  content: ReactNode;
};

export type GridColumn = { key: string; label: string; sub?: string; blocks: GridBlock[] };

const ROW = 14; // 10분 높이(px)
const HEAD = 38;

export default function TimeGrid({ from, to, columns, nowMin }: { from: number; to: number; columns: GridColumn[]; nowMin: number | null }) {
  const n = Math.max(1, (to - from) / 10);
  const height = n * ROW;
  return (
    <div className="card overflow-auto">
      <div className="relative flex w-max min-w-full">
        <div className="w-[74px] shrink-0 border-r border-line">
          <div className="sticky top-0 z-[2] border-b border-line bg-white" style={{ height: HEAD }} />
          <div className="relative" style={{ height }}>
            {Array.from({ length: n }, (_, i) =>
              (from + i * 10) % 60 === 0 ? (
                <div key={i} className="absolute right-2 -translate-y-[7px] text-[11px] text-muted" style={{ top: i * ROW }}>
                  {fmtTime(from + i * 10)}
                </div>
              ) : null,
            )}
          </div>
        </div>
        {columns.map((col) => {
          const items = lanes(col.blocks);
          const laneCount = Math.max(1, ...items.map((it) => it.lane + 1));
          const w = 100 / laneCount;
          return (
            <div key={col.key} className="flex-1 border-r border-line last:border-r-0" style={{ minWidth: 150 * laneCount, flexGrow: laneCount }}>
              <div
                className={`sticky top-0 z-[2] flex items-center justify-center gap-1.5 border-b border-line bg-white font-extrabold ${items.length ? "text-navy-800" : "text-navy-300"}`}
                style={{ height: HEAD }}
              >
                {col.label}
                {col.sub ? <small className="text-[11px] font-semibold text-muted">{col.sub}</small> : null}
              </div>
              <div className="relative" style={{ height }}>
                {Array.from({ length: n }, (_, i) => (
                  <div
                    key={i}
                    className={`absolute inset-x-0 border-t ${(from + i * 10) % 60 === 0 ? "border-line" : "border-navy-50"}`}
                    style={{ top: i * ROW, height: ROW }}
                  />
                ))}
                {Array.from({ length: laneCount - 1 }, (_, i) => (
                  <div key={`l${i}`} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${((i + 1) * 100) / laneCount}%` }} />
                ))}
                {items.map((it) => {
                  const top = ((it.start - from) / 10) * ROW;
                  const h = Math.max(ROW, ((it.end - it.start) / 10) * ROW) - 2;
                  const style: React.CSSProperties = {
                    top,
                    height: h,
                    left: `calc(${it.lane * w}% + 3px)`,
                    width: `calc(${w}% - 6px)`,
                  };
                  if (it.color && it.kind !== "booking") Object.assign(style, { background: it.color.bg, borderColor: it.color.border, color: it.color.text });
                  const kindCls =
                    it.kind === "sr"
                      ? "border-dashed"
                      : it.kind === "booking"
                        ? "border-dashed border-navy-400 text-navy-800 bg-[repeating-linear-gradient(135deg,#fff,#fff_6px,var(--color-navy-50)_6px,var(--color-navy-50)_12px)]"
                        : "";
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={it.onClick}
                      title={it.title}
                      className={`absolute overflow-hidden rounded-[7px] border px-1.5 py-0.5 text-left text-[11px] leading-[1.35] ${kindCls} ${it.onClick ? "cursor-pointer" : "cursor-default"}`}
                      style={style}
                    >
                      {it.content}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {nowMin !== null && nowMin >= from && nowMin < to ? (
          <div className="pointer-events-none absolute left-[74px] right-0 z-[3] border-t-2 border-now" style={{ top: HEAD + ((nowMin - from) / 10) * ROW }}>
            <span className="absolute -left-[70px] -top-[9px] rounded bg-now px-1.5 py-px text-[11px] font-bold text-white">{clockLabel(nowMin)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 요일의 세로축 범위 — 평일 오후 2시~10시, 주말 오전 10시~오후 3시가 기본, 블록이 넘치면 늘린다 */
export function dayRange(day: number, points: number[]): [number, number] {
  const weekend = day === 0 || day === 6;
  let a = weekend ? 10 * 60 : 14 * 60;
  let z = weekend ? 15 * 60 : 22 * 60;
  if (points.length) {
    a = Math.min(a, Math.floor(Math.min(...points) / 60) * 60);
    z = Math.max(z, Math.ceil(Math.max(...points) / 60) * 60);
  }
  return [a, z];
}
