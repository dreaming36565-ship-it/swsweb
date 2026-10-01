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
  /** 카운트 2가 된 날 (이 강제 숙제반을 알아보는 열쇠 — 확인 · 시작일 바꾸기에 씀) */
  trigger: string;
  /** 숙제반 시작일 — 기본 = trigger(당일). 숙제반 관리에서 바꿀 수 있다(trigger 이후만) */
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
 * starts: 바꾼 시작일 (카운트 2가 된 날 → 시작일). 없으면 카운트 2가 된 당일 시작.
 *         졸업(4번 연속 완료)은 시작일 다음 검사부터 센다.
 */
export function timeline(marks: Map<string, Mark>, checkDates: string[], from: string, to: string, starts?: Map<string, string>): Timeline {
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
      const st = starts?.get(d);
      cur = { trigger: d, start: st && st > d ? st : d, startMark: m, startCount: count, results: [], streak: 0, gradAt: null };
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

/**
 * 📷 확인 안 한 인증 날 — 인증 요일인데 지난 날(수업 당일 자정까지라 다음 날부터)인데 인증됨/미인증 기록이 없음.
 * 담당T에게 알림을 보낼 때 · 숙제반 현황 할 일에 쓴다.
 */
export function certUnchecked(plan: HwPlan, cycle: Cycle, cert: Map<string, "OK" | "MISS">, today: string): string[] {
  const last = cycle.gradAt && cycle.gradAt < today ? cycle.gradAt : addDays(today, -1);
  if (last < cycle.start) return [];
  return datesBetween(cycle.start, last).filter((d) => plan[dowOf(d)]?.how === "CERT" && !cert.has(d));
}

/* ---------------------------------------------------------------- 숙제반 칸 */

/**
 * 숙제반 칸 = 반 관리의 숙제반 (요일 · 시간).
 * 2026-09-30 확정: 월~목 1부 「초등숙제반 시간」 오후 4~6시 / 2부 「중등숙제반 시간」 오후 8~10시.
 * 학생은 요일마다 1부 · 2부 중 하나를 고른다 (예: 월 2부 · 목 1부) — 신청 · 강제 모두 요일 단위.
 */
export type HwSlot = { id: number; name: string; days: number[]; start: number; end: number };

/** 1부 · 2부 — 시작이 이른 칸이 1부 */
export const partNo = (slots: HwSlot[], slot: HwSlot) => [...slots].sort((a, b) => a.start - b.start).findIndex((s) => s.id === slot.id) + 1;

export type Busy = (day: number) => [number, number][];
/** 그 요일에 숙제반 시간이 수업 · SR과 겹치나 */
export const clashOn = (slot: HwSlot, day: number, busy: Busy) => busy(day).some(([a, b]) => overlaps(a, b, slot.start, slot.end));

/** 요일별 방법 — ATTEND 🏫 숙제반 참석 / CERT 📷 사진 인증 */
export type PlanDay = { how: "ATTEND"; slotId: number } | { how: "CERT" };
export type HwPlan = Partial<Record<number, PlanDay>>;

/**
 * 강제 숙제반 기본 방법 — 정규반 요일마다 숙제반 참석.
 * 칸: 그 요일에 신청해 다니는 칸 → 학교급 칸(초등 → 초등숙제반 시간, 중등 → 중등숙제반 시간) → 안 겹치는 아무 칸
 */
export function defaultPlan(
  slots: HwSlot[],
  opts: { applying: { day: number; slotId: number }[]; regularDays: number[]; busy: Busy; level: "초등" | "중등" | null },
): HwPlan {
  const p: HwPlan = {};
  for (const d of opts.regularDays) {
    const open = slots.filter((s) => s.days.includes(d) && !clashOn(s, d, opts.busy));
    const pick =
      open.find((s) => opts.applying.some((a) => a.day === d && a.slotId === s.id)) ??
      (opts.level ? open.find((s) => s.name.includes(opts.level!)) : undefined) ??
      open[0];
    if (pick) p[d] = { how: "ATTEND", slotId: pick.id };
  }
  return p;
}

/** 신청 요일 표시 — 「월 2부 · 목 1부」 */
export function applyLabel(slots: HwSlot[], list: { day: number; slotId: number }[]): string {
  return [...list]
    .sort((a, b) => a.day - b.day)
    .map((a) => {
      const s = slots.find((x) => x.id === a.slotId);
      return `${"일월화수목금토"[a.day]} ${s ? `${partNo(slots, s)}부` : "?"}`;
    })
    .join(" · ");
}

/**
 * 설문 응답의 요일 글 → 요일별 칸. 「월 8-10시, 목 4-6시」 · 「월수 8시」 · 「화 1부」
 * 요일 글자 묶음마다 뒤따르는 시각(또는 1부·2부)으로 칸을 정한다. 시각이 없으면 그 요일 칸이 하나일 때만.
 */
export function parseApplyText(text: string, slots: HwSlot[]): { day: number; slotId: number }[] | null {
  const out: { day: number; slotId: number }[] = [];
  const re = /([월화수목금토](?:\s*[,·/]?\s*[월화수목금토])*)\s*(?:요일)?\s*([^월화수목금토]*)/g;
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const days = [...m[1].matchAll(/[월화수목금토]/g)].map((x) => "일월화수목금토".indexOf(x[0]));
    const rest = m[2];
    const part = /([12])\s*부/.exec(rest)?.[1];
    const hour = /(\d{1,2})\s*(?:시|:|-|~)/.exec(rest)?.[1];
    for (const d of days) {
      const on = sorted.filter((s) => s.days.includes(d));
      const s = part
        ? on.find((x) => partNo(slots, x) === Number(part))
        : hour
          ? on.find((x) => Number(hour) % 12 === Math.floor(x.start / 60) % 12)
          : on.length === 1
            ? on[0]
            : undefined;
      if (!s) return null;
      out.push({ day: d, slotId: s.id });
    }
  }
  return out.length ? out : null;
}
