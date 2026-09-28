// 숙제검사 · 숙제반 규칙 — 순수 함수. 서버와 화면이 같은 규칙을 쓴다. DB 접근 금지.
//
// 확정 규칙 (2026-09-29):
//   - 빈칸 = 숙제 완료. 표시: 숙제미흡 0.5 · 준비물 미지참 0.5 · 숙제+준비물 미흡 1 · 숙제불량 2 · 결석(검사 없음)
//   - 카운트가 2가 되는 날 = 강제 숙제반 시작 (1.5 = 주황 경고). 카운트는 분기마다 0부터
//   - 졸업 = 시작 다음 SR 숙제검사(정규 요일 + 개별 금/토)에서 4번 연속 완료. 중간에 표시가 나오면 0부터, 결석은 건너뜀
//   - 졸업하면 카운트 0부터
//   - 📷 인증 문제(인증 후 다음 SR 검사 미흡, 또는 미인증): 그 달 1회 = 경고, 2회부터 = 그 달 남은 인증 요일은 숙제반 참석

import { overlaps } from "./time";

export const MARKS = {
  숙제미흡: { score: 0.5, short: "숙제미흡" },
  "준비물 미지참": { score: 0.5, short: "준비물" },
  "숙제+준비물 미흡": { score: 1, short: "숙+준" },
  숙제불량: { score: 2, short: "불량" },
  결석: { score: 0, short: "결석" },
} as const;
export type Mark = keyof typeof MARKS;
export const MARK_LIST = Object.keys(MARKS) as Mark[];
export const isMark = (v: string): v is Mark => (MARK_LIST as string[]).includes(v);

/* ---------------------------------------------------------------- 날짜 */

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dowOf = (s: string) => toDate(s).getDay();
export const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
export function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}
export const monthDates = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return datesBetween(`${ym}-01`, isoDate(new Date(y, m, 0)));
};
/** 9/28 */
export const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

/** 분기 — 1분기 12~2월 / 2분기 3~5월 / 3분기 6~8월 / 4분기 9~11월 */
export function quarterOf(date: string): { start: string; end: string; label: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const [sy, sm, q] = m === 12 ? [y, 12, 1] : m <= 2 ? [y - 1, 12, 1] : m <= 5 ? [y, 3, 2] : m <= 8 ? [y, 6, 3] : [y, 9, 4];
  const start = `${sy}-${pad(sm)}-01`;
  const endD = new Date(sy, sm - 1 + 3, 0);
  return { start, end: isoDate(endD), label: `${q}분기` };
}

/* ---------------------------------------------------------------- 카운트 · 강제 숙제반 */

export type CycleResult = { d: string; r: "ok" | "fail" | "skip"; m?: Mark };
export type Cycle = {
  start: string;
  startMark: Mark | null;
  startCount: number;
  results: CycleResult[];
  streak: number;
  gradAt: string | null;
};
export type Timeline = { count: number; cur: Cycle | null; cycles: Cycle[] };

/**
 * 한 학생의 숙제 흐름 (분기 처음부터 오늘까지 날짜순)
 * checkDates: 그 학생이 SR에서 숙제검사를 받는 날 (정규반 요일 + 개별반 금/토)
 */
export function timeline(marks: Map<string, Mark>, checkDates: string[], from: string, to: string): Timeline {
  let count = 0;
  let cur: Cycle | null = null;
  const cycles: Cycle[] = [];
  // 검사일 + 표시가 적힌 날 (시트처럼 금·토 칸 아무 데나 적힌 표시도 센다)
  const marked = [...marks.keys()].filter((d) => d >= from && d <= to);
  const days = [...new Set([...checkDates.filter((d) => d >= from && d <= to), ...marked])].sort();
  for (const d of days) {
    const m = marks.get(d) ?? null;
    if (cur && d > cur.start) {
      if (m === "결석") cur.results.push({ d, r: "skip" });
      else if (m) {
        cur.streak = 0;
        cur.results.push({ d, r: "fail", m });
      } else {
        cur.streak += 1;
        cur.results.push({ d, r: "ok" });
        if (cur.streak >= 4) {
          cur.gradAt = d;
          cur = null;
          count = 0;
          continue;
        }
      }
    }
    if (m && m !== "결석") count += MARKS[m].score;
    if (!cur && count >= 2) {
      cur = { start: d, startMark: m, startCount: count, results: [], streak: 0, gradAt: null };
      cycles.push(cur);
    }
  }
  return { count, cur, cycles };
}

/** 인증 문제 (그 달) — 📷 인증했는데 다음 SR 검사 미흡, 또는 인증을 안 올림(미인증) */
export function certIssues(cert: Map<string, "OK" | "MISS">, cycle: Cycle, ym: string): { d: string; why: string }[] {
  const out: { d: string; why: string }[] = [];
  for (const [d, v] of cert) {
    if (!d.startsWith(ym)) continue;
    if (v === "MISS") out.push({ d, why: "인증 안 올림" });
    else {
      const next = cycle.results.find((r) => r.d > d && r.r !== "skip");
      if (next?.r === "fail") out.push({ d, why: `인증 → ${md(next.d)} SR ${next.m}` });
    }
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

/* ---------------------------------------------------------------- 숙제반 칸 */

/** 숙제반 칸 = 반 관리의 숙제반 (요일 · 시간) */
export type HwSlot = { id: number; name: string; days: number[]; start: number; end: number };

export type Busy = (day: number) => [number, number][];
export const slotClashes = (slot: HwSlot, busy: Busy) =>
  slot.days.some((d) => busy(d).some(([a, b]) => overlaps(a, b, slot.start, slot.end)));

/** 강제 숙제반 칸: 이미 다니는 숙제반(신청) → 다니는 반 요일 중 안 겹치는 칸 → 아무 안 겹치는 칸 */
export function defaultForcedSlot(
  slots: HwSlot[],
  opts: { applyingSlotId: number | null; regularDays: number[]; busy: Busy },
): HwSlot | null {
  if (opts.applyingSlotId) {
    const s = slots.find((x) => x.id === opts.applyingSlotId);
    if (s) return s;
  }
  const want = [...opts.regularDays].sort().join(",");
  return (
    slots.find((s) => [...s.days].sort().join(",") === want && !slotClashes(s, opts.busy)) ??
    slots.find((s) => !slotClashes(s, opts.busy)) ??
    null
  );
}

/** 요일별 방법 — ATTEND 🏫 숙제반 참석 / CERT 📷 사진 인증 */
export type PlanDay = { how: "ATTEND"; slotId: number } | { how: "CERT" };
export type HwPlan = Partial<Record<number, PlanDay>>;

/** 기본: 강제 숙제반 칸의 요일은 모두 참석 */
export function defaultPlan(slot: HwSlot | null): HwPlan {
  const p: HwPlan = {};
  if (slot) for (const d of slot.days) p[d] = { how: "ATTEND", slotId: slot.id };
  return p;
}
