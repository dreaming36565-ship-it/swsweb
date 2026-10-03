// ★ 서버 전용. 📅 휴강 · 보충/옮김 읽기 — 시간표(listSessions) · 출결 · SR · 숙제검사가 함께 쓴다.
// (고치기는 repo/schedule.ts. 이 파일은 다른 repo 파일을 import 하지 않는다 — 서로 부르는 고리를 막으려고)

import { getDb } from "../db";
import { closuresOf } from "../seed";
import type { Closures } from "../schedule";
import { row, rows } from "./base";

/** from ~ to 날짜에 걸친 휴강 · 반 휴강 · 보충/옮김 (옮김은 from 또는 to 가 그 사이) */
export function closuresBetween(from: string, to: string): Closures {
  return closuresOf(getDb(), from, to);
}

/** 그 날짜에 수업이 없는 반 — all = 전체 휴강, ids = 반 휴강 + 다른 날로 옮겨 간 반 */
export function noLessonOn(date: string): { all: boolean; ids: Set<number> } {
  const db = getDb();
  const all = row<{ off: number }>(db.prepare("SELECT off FROM sched_days WHERE date = ?").get(date))?.off === 1;
  const ids = new Set<number>([
    ...rows<{ class_id: number }>(db.prepare("SELECT class_id FROM sched_class_off WHERE date = ?").all(date)).map((r) => r.class_id),
    ...rows<{ class_id: number }>(db.prepare("SELECT class_id FROM sched_moves WHERE kind = 'MOVE' AND from_date = ?").all(date)).map((r) => r.class_id),
  ]);
  return { all, ids };
}

/** 그 날짜로 옮겨 오거나 보충하는 수업 — 반 · 원래 날짜(보충이면 null) */
export function movedInOn(date: string): { classId: number; fromDate: string | null }[] {
  return rows(getDb().prepare("SELECT class_id AS classId, from_date AS fromDate FROM sched_moves WHERE to_date = ? ORDER BY id").all(date));
}
