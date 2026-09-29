// 시간표 충돌 감지 — DB를 모르는 순수 함수.

import type { Conflict } from "./types";
import { overlaps, fmtTime, rangeLabel, STEP } from "./time";
import { SEAT_CAPACITY } from "./sr";

export type ConflictSession = {
  id: number;
  classId: number;
  className: string;
  startMin: number;
  endMin: number;
  alphaStartMin: number | null;
  alphaEndMin: number | null;
  roomId: number | null;
  roomName: string | null;
  alphaRoomId: number | null;
  alphaRoomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
  studentIds: number[];
};

type Block = {
  sessionId: number;
  classId: number;
  label: string;
  roomId: number | null;
  roomName: string | null;
  start: number;
  end: number;
};

function blocksOf(s: ConflictSession): Block[] {
  const out: Block[] = [
    {
      sessionId: s.id,
      classId: s.classId,
      label: s.className,
      roomId: s.roomId,
      roomName: s.roomName,
      start: s.startMin,
      end: s.endMin,
    },
  ];
  if (s.alphaStartMin !== null && s.alphaEndMin !== null && s.alphaEndMin > s.alphaStartMin) {
    out.push({
      sessionId: s.id,
      classId: s.classId,
      label: `${s.className} 알파`,
      roomId: s.alphaRoomId,
      roomName: s.alphaRoomName,
      start: s.alphaStartMin,
      end: s.alphaEndMin,
    });
  }
  return out;
}

/**
 * 같은 요일의 수업들을 받아 충돌을 찾는다.
 * @param srRoomIds SR룸 강의실 id 집합 (좌석 초과 판정용)
 * @param together 🔗 합반인 두 반인가 — 합반은 같은 강의실 · 같은 선생님이어도 겹침이 아니다
 */
export function detectConflicts(
  sessions: ConflictSession[],
  srRoomIds: Set<number> = new Set(),
  together: (classA: number, classB: number) => boolean = () => false
): Conflict[] {
  const out: Conflict[] = [];

  // ① 같은 강의실 같은 시간 중복 (수업 + 알파 모두 강의실 점유로 본다)
  const blocks = sessions.flatMap(blocksOf).filter((b) => b.roomId !== null);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.sessionId === b.sessionId) continue;
      if (a.roomId !== b.roomId) continue;
      if (together(a.classId, b.classId)) continue;
      // SR룸은 좌석 단위로 공용이므로 강의실 중복으로 보지 않는다
      if (a.roomId !== null && srRoomIds.has(a.roomId)) continue;
      if (!overlaps(a.start, a.end, b.start, b.end)) continue;
      out.push({
        kind: "ROOM",
        message: `강의실 중복 — ${a.roomName}: ${a.label}(${rangeLabel(a.start, a.end)}) ↔ ${b.label}(${rangeLabel(b.start, b.end)})`,
        sessionIds: [a.sessionId, b.sessionId],
      });
    }
  }

  // ② 같은 선생님이 같은 시간에 두 수업
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      if (!a.teacherId || !b.teacherId || a.teacherId !== b.teacherId) continue;
      if (together(a.classId, b.classId)) continue;
      if (!overlaps(a.startMin, a.endMin, b.startMin, b.endMin)) continue;
      out.push({
        kind: "TEACHER",
        message: `선생님 중복 — ${a.teacherName}: ${a.className}(${rangeLabel(a.startMin, a.endMin)}) ↔ ${b.className}(${rangeLabel(b.startMin, b.endMin)})`,
        sessionIds: [a.id, b.id],
      });
    }
  }

  // ③ 학생 일정 중복 — 수업 + 알파를 모두 학생 점유시간으로 계산
  const seenPair = new Set<string>();
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      const shared = a.studentIds.filter((id) => b.studentIds.includes(id));
      if (shared.length === 0) continue;
      const aB = blocksOf(a);
      const bB = blocksOf(b);
      for (const x of aB) {
        for (const y of bB) {
          if (!overlaps(x.start, x.end, y.start, y.end)) continue;
          const key = `${a.id}-${b.id}`;
          if (seenPair.has(key)) continue;
          seenPair.add(key);
          out.push({
            kind: "STUDENT",
            message: `학생 일정 중복 — ${shared.length}명: ${x.label}(${rangeLabel(x.start, x.end)}) ↔ ${y.label}(${rangeLabel(y.start, y.end)})`,
            sessionIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // ④ SR 좌석 초과 — 10분 단위로 동시 알파 인원이 24석을 넘는지
  const alpha = sessions.filter(
    (s) =>
      s.alphaStartMin !== null &&
      s.alphaEndMin !== null &&
      s.alphaEndMin > s.alphaStartMin &&
      s.alphaRoomId !== null &&
      srRoomIds.has(s.alphaRoomId)
  );
  if (alpha.length > 0) {
    const from = Math.min(...alpha.map((s) => s.alphaStartMin!));
    const to = Math.max(...alpha.map((s) => s.alphaEndMin!));
    let worst = { at: -1, count: 0 };
    for (let t = from; t < to; t += STEP) {
      let count = 0;
      for (const s of alpha) {
        if (s.alphaStartMin! <= t && t < s.alphaEndMin!) count += s.studentIds.length;
      }
      if (count > worst.count) worst = { at: t, count };
    }
    if (worst.count > SEAT_CAPACITY) {
      out.push({
        kind: "SR_CAPACITY",
        message: `SR 좌석 초과 — ${fmtTime(worst.at)} 기준 ${worst.count}명 (${SEAT_CAPACITY}석)`,
        sessionIds: alpha.map((s) => s.id),
      });
    }
  }

  return out;
}
