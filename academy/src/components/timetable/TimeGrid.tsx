"use client";

// 시간 격자 (운영 시간표) — 10분 한 칸. 세로 = 시간, 가로 = 칸(SR · 선생님 · 교실 · 요일).
// 칸 폭은 고정(화면을 꽉 채우지 않는다). 한 칸 안에서 겹치는 블록은 줄(lane)을 나눠 나란히.
// SR 칸: 같은 시간대 반들을 큰 점선 상자로 묶고, 왼쪽에 가장 붐비는 순간의 총 인원 + 좌석 막대.
// 오늘 요일이면 주황 선 = 지금 시각. print 면 인쇄용(테두리 · 스크롤 없음).

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
  /** 🔗 합반 — 굵은 테두리 */
  hapban?: boolean;
  title?: string;
  onClick?: () => void;
  content: ReactNode;
};

export type GridColumn = { key: string; label: ReactNode; sub?: string; blocks: GridBlock[]; muted?: boolean };

/** SR 칸의 반 한 개 */
export type SrItem = {
  key: string;
  name: string;
  count: number;
  start: number;
  end: number;
  color?: ClassColor | null;
  onClick?: () => void;
  tag?: ReactNode;
};

const HEAD = 46;
const TIME_W = 66;
/** SR 칸 — 총 인원 칸 · 반 한 줄 폭 */
const TOT_W = 62;
const LANE_W = 108;

type Props = {
  from: number;
  to: number;
  columns: GridColumn[];
  nowMin: number | null;
  /** SR 칸 (맨 앞) */
  sr?: { label: string; seats: number; items: SrItem[] } | null;
  /** 10분 높이(px) */
  row?: number;
  /** 칸 폭(px) — 한 줄 기준 */
  colWidth?: number;
  print?: boolean;
};

/** 2시간 넘게 SR에 있는 반(숙제반 · 누적오답) — 점선 상자에 넣지 않고 오른쪽 줄에 따로 (인원은 상자 총 인원에 더한다) */
const LONG = 120;

/**
 * SR 같은 시간대 묶음(점선 상자) — 시작이 40분 안쪽으로 겹치는 반끼리.
 * 긴 반만 있는 시간(예: 8~10시 숙제반 · 누적오답)도 상자를 만들어 총 인원을 보여준다.
 * 총 인원 = 그 상자 시간 중 가장 붐비는 순간 (긴 반 포함). 반 블록의 줄(lane)은 하루 전체로 나눠 서로 겹치지 않는다.
 */
function clusters(items: SrItem[], long: SrItem[]) {
  const list = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: { start: number; end: number; items: SrItem[]; peak: number }[] = [];
  for (const it of list) {
    const g = groups.find((x) => it.start < x.end && x.start < it.end && it.start < x.start + 40);
    if (g) {
      g.items.push(it);
      g.end = Math.max(g.end, it.end);
    } else groups.push({ start: it.start, end: it.end, items: [it], peak: 0 });
  }
  // 긴 반만 있는 빈 시간
  const covered = (m: number) => groups.some((g) => g.start <= m && m < g.end);
  let gap: { start: number; end: number } | null = null;
  const minutes = [...new Set(long.flatMap((l) => Array.from({ length: Math.ceil((l.end - l.start) / 10) }, (_, i) => l.start + i * 10)))].sort((a, b) => a - b);
  const gaps: { start: number; end: number }[] = [];
  for (const m of minutes) {
    if (covered(m)) continue;
    if (gap && gap.end === m) gap.end = m + 10;
    else gaps.push((gap = { start: m, end: m + 10 }));
  }
  for (const g of gaps) groups.push({ ...g, items: [], peak: 0 });
  groups.sort((a, b) => a.start - b.start);
  for (const g of groups)
    for (let m = g.start; m < g.end; m += 10)
      g.peak = Math.max(g.peak, [...g.items, ...long].filter((i) => i.start <= m && m < i.end).reduce((a, i) => a + i.count, 0));
  return groups;
}

export default function TimeGrid({ from, to, columns, nowMin, sr, row = 20, colWidth = 190, print = false }: Props) {
  const n = Math.max(1, (to - from) / 10);
  const height = n * row;
  const y = (m: number) => ((m - from) / 10) * row;

  const rowLines = (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className={`absolute inset-x-0 border-t ${(from + i * 10) % 60 === 0 ? "border-line" : "border-navy-50"}`}
          style={{ top: i * row, height: row }}
        />
      ))}
    </>
  );
  const head = (label: ReactNode, sub?: string, muted?: boolean) => (
    <div
      className={`sticky top-0 z-[2] flex flex-col items-center justify-center border-b border-line bg-white text-[15px] font-extrabold leading-tight ${muted ? "text-navy-300" : "text-navy-800"}`}
      style={{ height: HEAD }}
    >
      {label}
      {sub ? <small className="text-[12px] font-semibold text-muted">{sub}</small> : null}
    </div>
  );

  const blockStyle = (b: { color?: ClassColor | null; kind?: GridBlock["kind"]; hapban?: boolean }): React.CSSProperties => {
    const s: React.CSSProperties = {};
    if (b.color && b.kind !== "booking") Object.assign(s, { background: b.color.bg, borderColor: b.color.border, color: b.color.text });
    if (b.hapban) Object.assign(s, { borderWidth: 2, boxShadow: "0 0 0 1.5px var(--color-navy-700)" });
    return s;
  };

  const longItems = sr ? lanes(sr.items.filter((i) => i.end - i.start >= LONG)) : [];
  const shortItems = sr ? lanes(sr.items.filter((i) => i.end - i.start < LONG)) : [];
  const groups = sr ? clusters(shortItems, longItems) : [];
  const srLanes = Math.max(1, ...shortItems.map((i) => i.lane + 1));
  const longLanes = longItems.length ? Math.max(...longItems.map((i) => i.lane + 1)) : 0;
  const boxW = TOT_W + srLanes * LANE_W + 4;
  const srWidth = boxW + longLanes * LANE_W + 10;

  /** SR 반 블록 — 반이름 · 인원 / 시간 */
  const srBlock = (it: SrItem, style: React.CSSProperties) => (
    <button
      key={it.key}
      type="button"
      onClick={it.onClick}
      title={`${it.name} ${clockLabel(it.start)}~${clockLabel(it.end)}`}
      className={`absolute overflow-hidden rounded-[8px] border-[1.5px] border-dashed px-1 text-center leading-[1.3] ${it.onClick ? "cursor-pointer" : "cursor-default"}`}
      style={{ ...style, ...blockStyle({ color: it.color }) }}
    >
      <div className="text-[14px] font-black">
        {it.name}
        <span className="ml-1 rounded bg-white px-1 align-[1px] text-[12px] font-extrabold text-ink">{it.count}</span>
      </div>
      <div className="text-[12px] opacity-85">
        {clockLabel(it.start)}~{clockLabel(it.end)}
      </div>
      {it.tag}
    </button>
  );

  return (
    <div className={print ? "w-max border border-line bg-white" : "card overflow-auto"}>
      <div className="relative flex w-max">
        {/* 시간 */}
        <div className="shrink-0 border-r border-line" style={{ width: TIME_W }}>
          <div className="sticky top-0 z-[2] border-b border-line bg-white" style={{ height: HEAD }} />
          <div className="relative" style={{ height }}>
            {rowLines}
            {Array.from({ length: n }, (_, i) =>
              (from + i * 10) % 30 === 0 ? (
                <div
                  key={i}
                  className={`absolute right-1.5 -translate-y-[8px] text-[12px] ${(from + i * 10) % 60 === 0 ? "font-bold text-ink" : "text-muted"}`}
                  style={{ top: i * row }}
                >
                  {(from + i * 10) % 60 === 0 ? fmtTime(from + i * 10) : clockLabel(from + i * 10)}
                </div>
              ) : null,
            )}
          </div>
        </div>

        {/* SR — 같은 시간대 점선 상자 + 총 인원 */}
        {sr ? (
          <div className="shrink-0 border-r border-line bg-navy-50/40" style={{ width: srWidth }}>
            {head(sr.label, `${sr.seats}석`)}
            <div className="relative" style={{ height }}>
              {rowLines}
              {groups.map((g, gi) => {
                const pct = Math.min(100, Math.round((g.peak / Math.max(1, sr.seats)) * 100));
                const over = g.peak > sr.seats;
                return (
                  <div
                    key={`${g.start}-${gi}`}
                    className="absolute left-[3px] rounded-[10px] border-2 border-dashed border-navy-300 bg-navy-50/70"
                    style={{ top: y(g.start), height: y(g.end) - y(g.start) - 2, width: boxW }}
                  >
                    <div className="absolute inset-y-0 left-0 flex flex-col items-center border-r border-dashed border-navy-300 pt-1.5" style={{ width: TOT_W - 4 }}>
                      <b className={`text-[26px] font-black leading-none ${over ? "text-alert" : "text-navy-900"}`}>{g.peak}</b>
                      <span className="mt-0.5 text-[11px] font-bold text-muted">명 · SR{gi + 1}</span>
                      <div className="mt-1 h-[5px] w-10 overflow-hidden rounded-full bg-navy-100">
                        <i className={`block h-full ${over ? "bg-alert" : "bg-navy-600"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {shortItems.map((it) =>
                srBlock(it, { left: 3 + TOT_W + it.lane * LANE_W, width: LANE_W - 6, top: y(it.start) + 2, height: y(it.end) - y(it.start) - 6 }),
              )}
              {longItems.map((it) =>
                srBlock(it, { left: boxW + 6 + it.lane * LANE_W, width: LANE_W - 6, top: y(it.start) + 2, height: y(it.end) - y(it.start) - 4 }),
              )}
            </div>
          </div>
        ) : null}

        {/* 선생님 · 교실 · 요일 칸 */}
        {columns.map((col) => {
          const items = lanes(col.blocks);
          const laneCount = Math.max(1, ...items.map((it) => it.lane + 1));
          return (
            <div key={col.key} className="shrink-0 border-r border-line last:border-r-0" style={{ width: colWidth * laneCount }}>
              {head(col.label, col.sub, col.muted ?? !items.length)}
              <div className="relative" style={{ height }}>
                {rowLines}
                {items.map((it) => {
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
                      className={`absolute overflow-hidden rounded-[8px] border-[1.5px] px-1 py-0.5 text-center leading-[1.3] ${kindCls} ${it.onClick ? "cursor-pointer" : "cursor-default"}`}
                      style={{
                        top: y(it.start),
                        height: Math.max(row, y(it.end) - y(it.start)) - 2,
                        left: it.lane * colWidth + 4,
                        width: colWidth - 8,
                        ...blockStyle(it),
                      }}
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
          <div className="pointer-events-none absolute right-0 z-[3] border-t-2 border-now" style={{ left: TIME_W, top: HEAD + y(nowMin) }}>
            <span className="absolute -top-[9px] rounded bg-now px-1.5 py-px text-[11px] font-bold text-white" style={{ left: -TIME_W + 2 }}>
              {clockLabel(nowMin)}
            </span>
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
  // 위아래 30분 여유 — 첫 줄(2:00) · 끝 줄(10:00) 글자가 잘리지 않게
  return [a - 30, z + 30];
}

/** 블록 범위에 딱 맞춘 세로축 (정시로 맞추고 위아래 30분 여유) — 선생님 한 주 · 인쇄용 */
export function fitRange(points: number[]): [number, number] {
  if (!points.length) return [13 * 60 + 30, 22 * 60 + 30];
  return [Math.floor(Math.min(...points) / 60) * 60 - 30, Math.ceil(Math.max(...points) / 60) * 60 + 30];
}
