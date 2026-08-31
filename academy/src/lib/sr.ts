// SR(알파) 좌석 배정 — DB를 모르는 순수 함수. 테스트·재사용 목적으로 이 원칙을 유지할 것.
//
// 자동배정 원칙(확정 사항):
//   "같은 반 친구들은 세로줄(같은 열)로 위아래 연속 배치한다."
// 수동이동 원칙(확정 사항):
//   "해당 학생의 SR 이용시간 전체 구간 동안 단 한 번도 다른 배정이 없는 좌석만 이동 가능."

import { overlaps } from "./time";

export const SEAT_COLS = ["A", "B", "C", "D"] as const;
export const SEAT_ROWS = 6;
export const SEAT_CAPACITY = SEAT_COLS.length * SEAT_ROWS; // 24석

export type SeatCol = (typeof SEAT_COLS)[number];

/** A1…A6, B1…B6, C1…C6, D1…D6 */
export const SEATS: string[] = SEAT_COLS.flatMap((c) =>
  Array.from({ length: SEAT_ROWS }, (_, i) => `${c}${i + 1}`)
);

export function seatCol(seat: string): string {
  return seat.slice(0, 1);
}

export function seatRow(seat: string): number {
  return parseInt(seat.slice(1), 10);
}

/** 자동배정 입력 — 하루치 알파 블록 */
export type AlphaBlock = {
  sessionId: number;
  classId: number;
  className: string;
  startMin: number;
  endMin: number;
  studentIds: number[];
};

export type SeatAssignment = {
  sessionId: number;
  classId: number;
  studentId: number;
  seat: string;
  startMin: number;
  endMin: number;
};

type Interval = { start: number; end: number };

function isFree(taken: Map<string, Interval[]>, seat: string, start: number, end: number): boolean {
  const list = taken.get(seat);
  if (!list) return true;
  return !list.some((iv) => overlaps(start, end, iv.start, iv.end));
}

/** 한 열에서 [start,end) 동안 비어 있는 연속 구간들을 반환 */
function freeRuns(
  taken: Map<string, Interval[]>,
  col: string,
  start: number,
  end: number
): { seats: string[] }[] {
  const runs: { seats: string[] }[] = [];
  let cur: string[] = [];
  for (let r = 1; r <= SEAT_ROWS; r++) {
    const seat = `${col}${r}`;
    if (isFree(taken, seat, start, end)) {
      cur.push(seat);
    } else if (cur.length) {
      runs.push({ seats: cur });
      cur = [];
    }
  }
  if (cur.length) runs.push({ seats: cur });
  return runs;
}

/**
 * 같은 반을 같은 열에 연속 배치한다.
 * 한 열에 다 못 앉히면 최소 개수의 열로 쪼갠다(best-fit).
 * 배치 순서: 알파 시작이 이른 순 → 인원 많은 반 순.
 */
export function autoAssignSeats(blocks: AlphaBlock[]): SeatAssignment[] {
  const taken = new Map<string, Interval[]>();
  const out: SeatAssignment[] = [];

  const ordered = [...blocks].sort(
    (a, b) =>
      a.startMin - b.startMin ||
      b.studentIds.length - a.studentIds.length ||
      a.classId - b.classId
  );

  for (const block of ordered) {
    const students = [...block.studentIds];
    if (students.length === 0) continue;

    const place = (seats: string[]) => {
      for (const seat of seats) {
        const studentId = students.shift();
        if (studentId === undefined) return;
        out.push({
          sessionId: block.sessionId,
          classId: block.classId,
          studentId,
          seat,
          startMin: block.startMin,
          endMin: block.endMin,
        });
        const list = taken.get(seat) ?? [];
        list.push({ start: block.startMin, end: block.endMin });
        taken.set(seat, list);
      }
    };

    // 1순위 — 한 열에 통째로 연속 배치 (best-fit: 남는 자리가 가장 적은 열)
    let best: string[] | null = null;
    for (const col of SEAT_COLS) {
      for (const run of freeRuns(taken, col, block.startMin, block.endMin)) {
        if (run.seats.length >= students.length) {
          if (!best || run.seats.length < best.length) best = run.seats;
        }
      }
    }
    if (best) {
      place(best.slice(0, students.length));
      continue;
    }

    // 2순위 — 최소 개수의 열로 쪼갠다: 남은 인원을 가장 큰 연속 구간부터 채운다
    while (students.length > 0) {
      let pick: string[] | null = null;
      for (const col of SEAT_COLS) {
        for (const run of freeRuns(taken, col, block.startMin, block.endMin)) {
          if (!pick || run.seats.length > pick.length) pick = run.seats;
        }
      }
      if (!pick || pick.length === 0) break; // 좌석 부족 — 충돌 감지에서 경고된다
      place(pick.slice(0, students.length));
    }
  }

  return out;
}

/** 좌석 상태 판정에 쓰는 최소 배정 정보 */
export type SeatUse = {
  id: number;
  studentId: number;
  seat: string;
  startMin: number;
  endMin: number;
};

/**
 * 이동 가능 좌석 — 대상 학생의 이용시간 전체 구간 동안
 * 다른 배정이 단 한 번도 없는 좌석만 인정한다. (현재 좌석은 제외)
 */
export function movableSeats(target: SeatUse, all: SeatUse[]): string[] {
  const others = all.filter((a) => a.id !== target.id);
  return SEATS.filter((seat) => {
    if (seat === target.seat) return false;
    return !others.some(
      (a) => a.seat === seat && overlaps(target.startMin, target.endMin, a.startMin, a.endMin)
    );
  });
}

/** 특정 시각에 그 좌석을 쓰는 배정 */
export function occupantAt(seat: string, atMin: number, all: SeatUse[]): SeatUse | null {
  return all.find((a) => a.seat === seat && a.startMin <= atMin && atMin < a.endMin) ?? null;
}
