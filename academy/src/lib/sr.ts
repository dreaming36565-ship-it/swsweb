// SR 자리 — DB를 모르는 순수 함수. 서버(자리 계산)와 화면(빈자리 표시)이 같은 규칙을 쓴다.
//
// 자리 규칙 (2026-09-28 확정):
//   - 학생은 그 반이 SR을 쓰는 모든 요일·시간에 같은 자리 (주간 자리)
//   - 같은 반은 같은 열(세로줄), 앞자리(1번)부터. 한 열(6석)에 다 못 앉으면 두 열로
//   - 고등과 초등이 같은 시간에 쓰면 최대한 먼 열 (고등 D ↔ 초등 A), 중등은 가운데(B·C)
//   - 한 번 정한 자리는 그대로 둔다 (퇴원으로 빈자리가 생겨도 다른 학생은 안 움직임) — 매달 1일에 앞으로 당겨 정리
//   - 사람이 옮긴 자리(manual)는 다시 계산해도 그대로
// 새 규칙 (2026-10-01부터, rules 2) — 위가 먼저:
//   ① 고등부(누적오답 포함)는 혼자 쓰는 열, 되도록 옆 열도 비워 떨어뜨린다
//   ② 고등 ↔ 초등 먼 열  ③ 같은 학년 반은 열을 띄워서(같은 열·바로 옆 열 피함)  ④ 같은 반 같은 열
//   매달 1일에는 사람이 옮긴 자리까지 초기화하고 처음부터 다시 앉힌다 (fresh)
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

/** 새 규칙(rules 2)을 쓰는 달 — 2026-10 부터 */
export const SR_RULES2_FROM = "2026-10";
export const srRulesFor = (month: string): 1 | 2 => (month >= SR_RULES2_FROM ? 2 : 1);

/** 같은 학년 비교용 — 초·중·고 학년이 있는 반만 (숙제반 · 개별반 등은 빼고) */
export const gradeKey = (grade: string | null | undefined): string | null => (grade && /^(초|중|고)/.test(grade) ? grade : null);

/** 반이 SR을 쓰는 시간 한 칸 */
export type SrBlock = { classId: number; day: number; start: number; end: number };

export type SeatKey = string;
export const seatKey = (classId: number, studentId: number): SeatKey => `${classId}|${studentId}`;

export type PlanInput = {
  /** SR을 쓰는 반 — 학교급과 학생 */
  classes: { id: number; level: Level; members: number[]; grade?: string | null }[];
  blocks: SrBlock[];
  /** 지금 자리 — 그대로 둔다 (겹치게 되었거나 반에서 빠진 학생 자리는 버린다) */
  existing: { classId: number; studentId: number; seat: string; manual: boolean }[];
  /** 월초 정리: 사람이 옮긴 자리만 남기고, 반마다 쓰던 열 안에서 앞자리부터 다시 채운다 */
  pack?: boolean;
  /** 처음부터 다시 앉히기 — 지금 자리(사람이 옮긴 자리 포함)를 모두 버린다 */
  fresh?: boolean;
  /** 자리 규칙 판 — 2 = 고등 독립 열 · 같은 학년 띄우기 (기본 1) */
  rules?: 1 | 2;
  /** 🔗 합반 짝 (반id → 짝 반id) — 짝이 앉은 열에 이어서 앉힌다 */
  partners?: Map<number, number>;
  /** 반id|학생id → 그 학생이 SR에 오는 요일 (숙제반처럼 반의 SR 요일과 다를 때) */
  memberDays?: Map<string, number[]>;
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

  /** 그 학생이 실제로 오는 SR 칸 — 숙제반은 오는 요일만 (memberDays) */
  const blocksOf = (classId: number, studentId: number) => {
    const days = input.memberDays?.get(seatKey(classId, studentId));
    const all = blocksBy.get(classId) ?? [];
    return days ? all.filter((b) => days.includes(b.day)) : all;
  };
  const seats: PlanResult["seats"] = new Map();
  /** 그 자리를 이미 쓰는가 — blocks 시간에 그 자리에 앉은 사람이 있으면 */
  const takenAt = (blocks: SrBlock[], seat: string) => {
    for (const s of seats.values()) if (s.seat === seat && blocksOverlap(blocksOf(s.classId, s.studentId), blocks)) return true;
    return false;
  };

  // 월초 정리 전에 반마다 쓰던 열 (사람이 옮긴 자리는 빼고)
  const keepColumns = new Map<number, string[]>();
  if (input.pack && !input.fresh) {
    for (const e of input.existing) {
      if (e.manual || !info.has(e.classId)) continue;
      const cols = keepColumns.get(e.classId) ?? [];
      if (!cols.includes(seatCol(e.seat))) cols.push(seatCol(e.seat));
      keepColumns.set(e.classId, cols.sort());
    }
  }

  // 1) 지금 자리 — 사람이 옮긴 자리 먼저
  const existing = (input.fresh ? [] : [...input.existing]).sort((a, b) => Number(b.manual) - Number(a.manual));
  for (const e of existing) {
    if (input.pack && !e.manual) continue;
    const c = info.get(e.classId);
    if (!c || !c.members.includes(e.studentId) || !SEATS.includes(e.seat)) continue;
    if (takenAt(blocksOf(e.classId, e.studentId), e.seat)) continue;
    seats.set(seatKey(e.classId, e.studentId), { ...e });
  }

  // 2) 자리가 없는 학생 — SR 요일이 많은 반 → 일찍 시작하는 반 → 인원 많은 반 순서로
  const firstStart = (id: number) => Math.min(...blocksBy.get(id)!.map((b) => b.day * 1440 + b.start));
  const v2 = input.rules === 2;
  const order = [...classes].sort(
    (a, b) =>
      (v2 ? Number(b.level === "H") - Number(a.level === "H") : 0) || // 새 규칙: 고등부 먼저 자리를 잡는다
      blocksBy.get(b.id)!.length - blocksBy.get(a.id)!.length ||
      firstStart(a.id) - firstStart(b.id) ||
      b.members.length - a.members.length ||
      a.id - b.id,
  );
  const overflow: PlanResult["overflow"] = [];
  const colsOf = (id: number) => [...new Set([...seats.values()].filter((s) => s.classId === id).map((s) => seatCol(s.seat)))];

  for (const c of order) {
    const todo = c.members.filter((m) => !seats.has(seatKey(c.id, m)));
    const need = todo.flatMap((m) => blocksOf(c.id, m));
    if (todo.length === 0) continue;
    const free = (col: string) =>
      Array.from({ length: SEAT_ROWS }, (_, i) => i + 1).filter((r) => !takenAt(need, `${col}${r}`));
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
              if (v2) {
                // ① 고등부는 다른 학교급과 같은 열 · 바로 옆 열을 피한다
                if ((c.level === "H") !== (oLv === "H")) score += dist === 0 ? 1000 : dist === 1 ? 300 : 0;
                // ③ 같은 학년 반은 열을 띄운다
                const g = gradeKey(c.grade);
                if (g && g === gradeKey(info.get(o)!.grade)) score += dist === 0 ? 80 : dist === 1 ? 60 : 0;
              }
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

/** ↔ 반 통째로 옮기기 — 열마다 옮길 수 있는지 */
export type ClassMoveOption =
  | { kind: "self" }
  /** 그 반이 SR을 쓰는 모든 시간에 비어 있는 열 */
  | { kind: "move" }
  /** 다른 반 한 개가 통째로 앉은 열 — 두 반 맞바꾸기 */
  | { kind: "swap"; classId: number; label: string }
  | { kind: "no"; reason: string };

const blockOverlap = (blocks: SrBlock[], u: SeatUse) => blocks.some((b) => b.day === u.day && overlaps(b.start, b.end, u.start, u.end));

/**
 * 반을 다른 열로 옮기기 / 맞바꾸기 판단. uses = 주간 자리 사용, blocksOf(반id) = 그 반의 SR 칸.
 * 옮기기: 그 반의 모든 SR 시간에 그 열을 쓰는 사람이 없을 때.
 * 맞바꾸기: 그 열을 쓰는 사람이 한 반뿐이고, 그 반 학생이 모두 그 열에 있고, 그 반이 원래 열로 와도 서로의 시간에 문제가 없을 때.
 */
export function classMoveOptions(uses: SeatUse[], blocksOf: (classId: number) => SrBlock[], classId: number): Map<string, ClassMoveOption> {
  const out = new Map<string, ClassMoveOption>();
  const mine = uses.filter((u) => u.classId === classId);
  const myCols = [...new Set(mine.map((u) => seatCol(u.seat)))];
  const myCount = new Set(mine.map((u) => u.key)).size;
  const myBlocks = blocksOf(classId);
  for (const col of SEAT_COLS) {
    if (myCols.length === 1 && myCols[0] === col) {
      out.set(col, { kind: "self" });
      continue;
    }
    if (myCount > SEAT_ROWS) {
      out.set(col, { kind: "no", reason: `${SEAT_ROWS}명이 넘는 반은 학생마다 옮겨 주세요` });
      continue;
    }
    const inCol = uses.filter((u) => seatCol(u.seat) === col && u.classId !== classId && blockOverlap(myBlocks, u));
    if (inCol.length === 0) {
      out.set(col, { kind: "move" });
      continue;
    }
    const others = [...new Set(inCol.map((u) => u.classId))];
    const other = others[0];
    if (others.length !== 1 || other === null) {
      out.set(col, { kind: "no", reason: `${[...new Set(inCol.map((u) => u.label))].join(" · ")}이(가) 써요` });
      continue;
    }
    const theirs = uses.filter((u) => u.classId === other);
    const label = inCol[0].label;
    if (myCols.length !== 1 || theirs.some((u) => seatCol(u.seat) !== col)) {
      out.set(col, { kind: "no", reason: `${label}이(가) 여러 열에 앉아 있어요` });
      continue;
    }
    // 그 반이 우리 열로 와도 되는가 — 그 반 시간에 우리 열을 쓰는 다른 사람(우리 반 빼고)이 없어야
    const theirBlocks = blocksOf(other);
    const clash = uses.find((u) => seatCol(u.seat) === myCols[0] && u.classId !== classId && u.classId !== other && blockOverlap(theirBlocks, u));
    out.set(col, clash ? { kind: "no", reason: `맞바꾸면 ${label}이(가) ${clash.label}과(와) 겹쳐요` } : { kind: "swap", classId: other, label });
  }
  return out;
}

/** 학생 둘 자리 맞바꾸기 판단 결과 */
export type StudentSwapCheck = { ok: true; other: SeatUse } | { ok: false; reason: string };

/**
 * 학생 자리 맞바꾸기 — key 학생이 seat 으로 가고, 거기 앉은 학생이 key 학생 자리로 온다.
 * seat 을 그 반 SR 시간에 쓰는 사람이 한 명뿐이고, 그 학생이 와도 그 반 SR 시간에 겹치는 사람이 없을 때만.
 */
export function studentSwapCheck(uses: SeatUse[], blocksOf: (classId: number) => SrBlock[], key: string, seat: string): StudentSwapCheck {
  const mine = uses.find((u) => u.key === key);
  if (!mine || mine.classId === null) return { ok: false, reason: "지금 자리가 없어요" };
  const inSeat = uses.filter((u) => u.seat === seat && u.key !== key && blockOverlap(keyBlocks(uses, key, blocksOf(mine.classId!)), u));
  const keys = [...new Set(inSeat.map((u) => u.key))];
  if (keys.length !== 1) return { ok: false, reason: `${[...new Set(inSeat.map((u) => `${u.name}(${u.label})`))].join(" · ")}이(가) 써요` };
  const other = inSeat[0];
  if (other.classId === null || other.studentId === null) return { ok: false, reason: `${other.name}은(는) 임시 자리예요` };
  const clash = uses.find((u) => u.seat === mine.seat && u.key !== key && u.key !== other.key && blockOverlap(keyBlocks(uses, other.key, blocksOf(other.classId!)), u));
  return clash ? { ok: false, reason: `맞바꾸면 ${other.name}이(가) ${clash.name}(${clash.label})과(와) 겹쳐요` } : { ok: true, other };
}

/**
 * 그 학생이 실제로 SR에 앉는 칸 — 숙제반처럼 반의 SR 요일 중 일부만 오면 그 요일만.
 * 자리가 아직 없으면(uses 에 없음) 반의 SR 칸 전부.
 */
export function keyBlocks(uses: SeatUse[], key: string, classBlocks: SrBlock[]): SrBlock[] {
  const own = uses.filter((u) => u.key === key && u.classId !== null);
  return own.length ? own.map((u) => ({ classId: u.classId!, day: u.day, start: u.start, end: u.end })) : classBlocks;
}
