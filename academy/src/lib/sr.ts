// SR 자리 — DB를 모르는 순수 함수. 서버(자리 계산)와 화면(빈자리 표시)이 같은 규칙을 쓴다.
//
// 자리 규칙 (2026-09-28 확정):
//   - 학생은 그 반이 SR을 쓰는 모든 요일·시간에 같은 자리 (주간 자리)
//   - 같은 반은 같은 열(세로줄), 앞자리(1번)부터. 한 열(6석)에 다 못 앉으면 두 열로
//   - 고등과 초등이 같은 시간에 쓰면 최대한 먼 열 (고등 D ↔ 초등 A), 중등은 가운데(B·C)
//   - 한 번 정한 자리는 그대로 둔다 (퇴원으로 빈자리가 생겨도 다른 학생은 안 움직임) — 매달 1일에 앞으로 당겨 정리
//   - 사람이 옮긴 자리(manual)는 다시 계산해도 그대로
// 수동 이동: 그 반이 SR을 쓰는 모든 요일·시간 동안 비어 있는 자리만.

import { overlaps } from "./time";

export const SEAT_COLS = ["A", "B", "C", "D"] as const;
export const SEAT_ROWS = 6;
export const SEAT_CAPACITY = SEAT_COLS.length * SEAT_ROWS; // 24석

/** A1…A6, B1…B6, C1…C6, D1…D6 */
export const SEATS: string[] = SEAT_COLS.flatMap((c) => Array.from({ length: SEAT_ROWS }, (_, i) => `${c}${i + 1}`));

export const seatCol = (seat: string) => seat.slice(0, 1);
export const seatRow = (seat: string) => parseInt(seat.slice(1), 10);

/** 학교급 — E 초등 · M 중등 · H 고등 */
export type Level = "E" | "M" | "H";
export const LEVEL_NAME: Record<Level, string> = { E: "초등", M: "중등", H: "고등" };

/** 학년 → 학교급. 직접 입력한 학년은 반에 저장한 학교급(초등·중등·고등)을 쓴다 */
export function gradeLevel(grade: string | null, level?: string | null): Level | null {
  if (grade === "누적오답") return "H";
  if (grade?.startsWith("초")) return "E";
  if (grade?.startsWith("중")) return "M";
  if (grade?.startsWith("고")) return "H";
  if (level === "초등") return "E";
  if (level === "중등") return "M";
  if (level === "고등") return "H";
  return null;
}

// 먼저 앉히는 열 — 초등은 왼쪽(A)부터, 고등은 오른쪽(D)부터, 중등은 가운데
const PREF: Record<Level, string[]> = { E: ["A", "B", "C", "D"], M: ["B", "C", "A", "D"], H: ["D", "C", "B", "A"] };

/** 반이 SR을 쓰는 시간 한 칸 */
export type SrBlock = { classId: number; day: number; start: number; end: number };

export type SeatKey = string;
export const seatKey = (classId: number, studentId: number): SeatKey => `${classId}|${studentId}`;

export type PlanInput = {
  /** SR을 쓰는 반 — 학교급과 학생 */
  classes: { id: number; level: Level; members: number[] }[];
  blocks: SrBlock[];
  /** 지금 자리 — 그대로 둔다 (겹치게 되었거나 반에서 빠진 학생 자리는 버린다) */
  existing: { classId: number; studentId: number; seat: string; manual: boolean }[];
  /** 월초 정리: 사람이 옮긴 자리만 남기고, 반마다 쓰던 열 안에서 앞자리부터 다시 채운다 */
  pack?: boolean;
  /** 🔗 합반 짝 (반id → 짝 반id) — 짝이 앉은 열에 이어서 앉힌다 */
  partners?: Map<number, number>;
};

export type PlanResult = {
  seats: Map<SeatKey, { classId: number; studentId: number; seat: string; manual: boolean }>;
  /** 빈자리가 모자라 못 앉은 학생 */
  overflow: { classId: number; studentId: number }[];
};

const blocksOverlap = (a: SrBlock[], b: SrBlock[]) =>
  a.some((x) => b.some((y) => x.day === y.day && overlaps(x.start, x.end, y.start, y.end)));

/** 한 주 자리 배치 */
export function planSeats(input: PlanInput): PlanResult {
  const blocksBy = new Map<number, SrBlock[]>();
  for (const b of input.blocks) blocksBy.set(b.classId, [...(blocksBy.get(b.classId) ?? []), b]);
  const classes = input.classes.filter((c) => blocksBy.has(c.id));
  const info = new Map(classes.map((c) => [c.id, c]));
  const overlapping = new Map(
    classes.map((c) => [c.id, classes.filter((o) => o.id !== c.id && blocksOverlap(blocksBy.get(c.id)!, blocksBy.get(o.id)!)).map((o) => o.id)]),
  );

  const seats: PlanResult["seats"] = new Map();
  /** 그 자리를 이미 쓰는가 — 같은 반이거나 시간이 겹치는 반 */
  const taken = (classId: number, seat: string) => {
    for (const s of seats.values()) {
      if (s.seat !== seat) continue;
      if (s.classId === classId || overlapping.get(classId)?.includes(s.classId)) return true;
    }
    return false;
  };

  // 월초 정리 전에 반마다 쓰던 열 (사람이 옮긴 자리는 빼고)
  const keepColumns = new Map<number, string[]>();
  if (input.pack) {
    for (const e of input.existing) {
      if (e.manual || !info.has(e.classId)) continue;
      const cols = keepColumns.get(e.classId) ?? [];
      if (!cols.includes(seatCol(e.seat))) cols.push(seatCol(e.seat));
      keepColumns.set(e.classId, cols.sort());
    }
  }

  // 1) 지금 자리 — 사람이 옮긴 자리 먼저
  const existing = [...input.existing].sort((a, b) => Number(b.manual) - Number(a.manual));
  for (const e of existing) {
    if (input.pack && !e.manual) continue;
    const c = info.get(e.classId);
    if (!c || !c.members.includes(e.studentId) || !SEATS.includes(e.seat)) continue;
    if (taken(e.classId, e.seat)) continue;
    seats.set(seatKey(e.classId, e.studentId), { ...e });
  }

  // 2) 자리가 없는 학생 — SR 요일이 많은 반 → 일찍 시작하는 반 → 인원 많은 반 순서로
  const firstStart = (id: number) => Math.min(...blocksBy.get(id)!.map((b) => b.day * 1440 + b.start));
  const order = [...classes].sort(
    (a, b) =>
      blocksBy.get(b.id)!.length - blocksBy.get(a.id)!.length ||
      firstStart(a.id) - firstStart(b.id) ||
      b.members.length - a.members.length ||
      a.id - b.id,
  );
  const overflow: PlanResult["overflow"] = [];
  const colsOf = (id: number) => [...new Set([...seats.values()].filter((s) => s.classId === id).map((s) => seatCol(s.seat)))];

  for (const c of order) {
    const todo = c.members.filter((m) => !seats.has(seatKey(c.id, m)));
    if (todo.length === 0) continue;
    const free = (col: string) =>
      Array.from({ length: SEAT_ROWS }, (_, i) => i + 1).filter((r) => !taken(c.id, `${col}${r}`));
    const room = (cols: string[]) => cols.reduce((n, col) => n + free(col).length, 0);

    let best: { cols: string[]; score: number } | null = null;
    const keep = keepColumns.get(c.id);
    if (keep && keep.length && room(keep) >= todo.length) best = { cols: keep, score: -1 };
    // 이미 앉은 친구가 있으면 그 열부터 채운다
    const mine = colsOf(c.id);
    if (!best && mine.length && room(mine) >= todo.length) best = { cols: mine, score: -1 };
    // 🔗 합반은 짝이 앉은 열에 이어서 (짝의 자리는 겹치는 시간이라 이미 차 있으니 그 뒤부터)
    const partner = input.partners?.get(c.id);
    const pCols = partner !== undefined ? colsOf(partner) : [];
    if (!best && pCols.length && room(pCols) >= todo.length) best = { cols: pCols, score: -1 };
    if (!best) {
      const options: string[][] = [];
      for (const c1 of SEAT_COLS) {
        options.push([c1]);
        for (const c2 of SEAT_COLS) if (c2 !== c1) options.push([c1, c2]);
      }
      for (const cols of options) {
        if (room(cols) < todo.length) continue;
        if (cols.length === 2 && free(cols[0]).length >= todo.length) continue; // 한 열로 되면 나누지 않는다
        let score = PREF[c.level].indexOf(cols[0]) * 10 + (cols[1] ? 40 + PREF[c.level].indexOf(cols[1]) * 10 : 0);
        for (const o of overlapping.get(c.id) ?? []) {
          const oCols = colsOf(o);
          const oLv = info.get(o)!.level;
          for (const x of cols) {
            for (const y of oCols) {
              const dist = Math.abs(SEAT_COLS.indexOf(x as never) - SEAT_COLS.indexOf(y as never));
              if ((c.level === "E" && oLv === "H") || (c.level === "H" && oLv === "E")) score += (3 - dist) * 100; // 고등 ↔ 초등 멀리
              // 겹치는 반과 같은 열은 되도록 피한다 — 같은 학교급끼리 한 열을 나눠 쓰는 건 괜찮다
              if (x === y) score += c.level === oLv ? 5 : 15;
            }
          }
        }
        if (!best || score < best.score) best = { cols, score };
      }
    }
    // 빈자리가 모자라면 남는 자리만큼만 앉히고 나머지는 "자리 없음"
    if (!best) best = { cols: [...SEAT_COLS].sort((a, b) => free(b).length - free(a).length), score: 0 };
    const rows = best.cols.flatMap((col) => free(col).map((r) => `${col}${r}`));
    todo.forEach((m, i) => {
      if (rows[i]) seats.set(seatKey(c.id, m), { classId: c.id, studentId: m, seat: rows[i], manual: false });
      else overflow.push({ classId: c.id, studentId: m });
    });
  }
  return { seats, overflow };
}

/** 자리를 쓰는 한 구간 — 화면에서 빈자리·누가 쓰는지 판단할 때 */
export type SeatUse = {
  /** 반id|학생id, 임시 자리는 adhoc:id */
  key: string;
  seat: string;
  day: number;
  start: number;
  end: number;
  name: string;
  /** 반 이름 또는 임시 자리 종류 */
  label: string;
  classId: number | null;
  studentId: number | null;
  /** 임시 자리 id */
  adhocId?: number;
};

/** [start,end) 동안 그 자리를 쓰는 사람 — 없으면 null */
export function seatBlocker(uses: SeatUse[], day: number, seat: string, start: number, end: number, ignoreKey?: string): SeatUse | null {
  return (
    uses.find((u) => u.day === day && u.seat === seat && u.key !== ignoreKey && overlaps(start, end, u.start, u.end)) ?? null
  );
}

/**
 * 그 시간 내내 비어 있는 자리 — 앞자리(1번 줄, 칠판 앞)부터, 같은 줄은 A → D.
 * 🙋 SR 자리 요청의 추천 자리는 이 목록의 첫 번째.
 */
export function freeSeatsBetween(uses: SeatUse[], day: number, start: number, end: number): string[] {
  const out: string[] = [];
  for (let r = 1; r <= SEAT_ROWS; r++) for (const c of SEAT_COLS) if (!seatBlocker(uses, day, `${c}${r}`, start, end)) out.push(`${c}${r}`);
  return out;
}

/** 그 시각에 앉아 있는 사람 { 자리: 사용 } */
export function occupantsAt(uses: SeatUse[], day: number, minute: number): Map<string, SeatUse> {
  const out = new Map<string, SeatUse>();
  for (const u of uses) if (u.day === day && u.start <= minute && minute < u.end) out.set(u.seat, u);
  return out;
}

/**
 * 자리를 옮길 수 있는 곳 — 그 반이 SR을 쓰는 모든 요일·시간 동안 비어 있는 자리만.
 * uses 는 주간 자리(요일별), blocks 는 그 반의 SR 칸들.
 */
export function movableSeatsFor(uses: SeatUse[], blocks: SrBlock[], key: string): Map<string, SeatUse | null> {
  const out = new Map<string, SeatUse | null>();
  for (const seat of SEATS) {
    let who: SeatUse | null = null;
    for (const b of blocks) {
      who = seatBlocker(uses, b.day, seat, b.start, b.end, key);
      if (who) break;
    }
    out.set(seat, who);
  }
  return out;
}
