// ★ 서버 전용. 🏫 학교 학사일정 — 학교 · 항목별 날짜 칸 · 교과서 · 시험 D-40 알림.
// 날짜 · 항목 규칙은 lib/school.ts (순수 함수).

import { getDb } from "../db";
import { assert } from "../errors";
import { can } from "../perm";
import { EXAM_ALERT_DAYS, addDays, catOf, daysBetween, rangeText, type SchoolLevel, type SchoolRange } from "../school";
import type { SessionUser } from "../types";
import { notify, nowIso, rows, today, transaction, userIdsWithRole } from "./base";

export type School = { id: number; name: string; level: SchoolLevel };
/** from = null 이면 「없음」(시트의 -) */
export type SchoolEvent = { id: number; schoolId: number; kind: string; grades: string | null; from: string | null; to: string | null; updatedBy: string | null; updatedAt: string | null };
export type SchoolBook = { schoolId: number; subject: string; publisher: string; updatedBy: string | null; updatedAt: string | null };
export type SchoolData = { today: string; schools: School[]; events: SchoolEvent[]; books: SchoolBook[] };

export function schoolData(): SchoolData {
  const db = getDb();
  return {
    today: today(),
    schools: rows<School>(db.prepare("SELECT id, name, level FROM schools ORDER BY order_no, id").all()),
    events: rows<SchoolEvent>(
      db
        .prepare(
          `SELECT id, school_id AS schoolId, kind, grades, start_date AS "from", end_date AS "to", updated_by AS updatedBy, updated_at AS updatedAt
             FROM school_events ORDER BY start_date, id`,
        )
        .all(),
    ),
    books: rows<SchoolBook>(
      db.prepare("SELECT school_id AS schoolId, subject, publisher, updated_by AS updatedBy, updated_at AS updatedAt FROM school_books").all(),
    ),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function schoolName(id: number): string {
  const s = rows<{ name: string }>(getDb().prepare("SELECT name FROM schools WHERE id = ?").all(id))[0];
  assert(s, "학교를 찾을 수 없어요. 화면을 새로고침해 주세요.");
  return s.name;
}

/**
 * 항목 칸 저장 — 그 학교 그 항목의 날짜를 통째로 바꾼다 (append = ＋ 일정 추가: 있던 날짜에 더함).
 * none = 「없음」(시트의 -). ranges 도 없고 none 도 아니면 칸을 비운다.
 */
export function saveSchoolCell(
  user: SessionUser,
  input: { schoolId: number; kind: string; ranges: SchoolRange[]; none?: boolean; append?: boolean },
): void {
  assert(can(user, "school.write"), "학사일정을 고칠 권한이 없어요.");
  const kind = (input.kind ?? "").trim();
  assert(kind, "항목 이름을 적어 주세요. (예: 학부모총회)");
  assert(kind.length <= 30, "항목 이름은 30자까지예요.");
  schoolName(input.schoolId);
  const ranges = input.ranges ?? [];
  for (const r of ranges) {
    assert(DATE.test(r.from) && DATE.test(r.to), "날짜를 골라 주세요.");
    assert(r.from <= r.to, `끝 날짜가 시작보다 빨라요. (${rangeText(r)})`);
    assert(daysBetween(r.from, r.to) <= 62, "한 칸은 두 달까지만 넣을 수 있어요.");
    assert(!r.grades || r.grades.length <= 20, "학년은 20자까지예요.");
  }
  if (input.append) assert(ranges.length > 0, "날짜를 하나 이상 넣어 주세요.");
  const db = getDb();
  const now = nowIso();
  const t = today();
  // 시작 날짜가 그대로인 칸은 이미 보낸 알림을 다시 보내지 않는다
  const sent = new Set(
    rows<{ start_date: string }>(
      db.prepare("SELECT start_date FROM school_events WHERE school_id = ? AND kind = ? AND d40_sent = 1 AND start_date IS NOT NULL").all(input.schoolId, kind),
    ).map((x) => x.start_date),
  );
  transaction(() => {
    if (!input.append) db.prepare("DELETE FROM school_events WHERE school_id = ? AND kind = ?").run(input.schoolId, kind);
    else db.prepare("DELETE FROM school_events WHERE school_id = ? AND kind = ? AND start_date IS NULL").run(input.schoolId, kind);
    const ins = db.prepare(
      "INSERT INTO school_events (school_id, kind, grades, start_date, end_date, d40_sent, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // 이미 지난 시험은 알림 안 보냄. D-40 안쪽으로 새로 넣은 시험은 다음 확인 때 알림(남은 날 수로)
    for (const r of ranges) ins.run(input.schoolId, kind, r.grades?.trim() || null, r.from, r.to, r.from < t || sent.has(r.from) ? 1 : 0, user.name, now);
    if (!ranges.length && input.none) ins.run(input.schoolId, kind, null, null, null, 1, user.name, now);
  });
}

/** 교과서(출판사) — 빈칸이면 지운다 */
export function saveSchoolBook(user: SessionUser, schoolId: number, subject: string, publisher: string): void {
  assert(can(user, "school.write"), "학사일정을 고칠 권한이 없어요.");
  schoolName(schoolId);
  const sub = (subject ?? "").trim();
  assert(sub, "과목을 찾을 수 없어요.");
  const pub = (publisher ?? "").trim();
  assert(pub.length <= 30, "출판사는 30자까지예요.");
  const db = getDb();
  if (!pub) db.prepare("DELETE FROM school_books WHERE school_id = ? AND subject = ?").run(schoolId, sub);
  else
    db.prepare(
      `INSERT INTO school_books (school_id, subject, publisher, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(school_id, subject) DO UPDATE SET publisher = excluded.publisher, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(schoolId, sub, pub, user.name, nowIso());
}

const g = globalThis as unknown as { __academySchoolCheck?: number };

/**
 * 📚 시험대비 알림 — 시험 D-40 이 된(또는 지난) 시험을 관리자 알림함으로 (같은 때 여러 학교면 한 번에).
 * 4초 폴링에서 1분에 한 번만 본다. 보낸 시험은 d40_sent = 1.
 */
export function remindSchoolExams(): void {
  const now = Date.now();
  if (g.__academySchoolCheck && now - g.__academySchoolCheck < 60_000) return;
  g.__academySchoolCheck = now;
  const db = getDb();
  const t = today();
  const due = rows<{ id: number; kind: string; grades: string | null; from: string; to: string; school: string }>(
    db
      .prepare(
        `SELECT e.id, e.kind, e.grades, e.start_date AS "from", e.end_date AS "to", s.name AS school
           FROM school_events e JOIN schools s ON s.id = e.school_id
          WHERE e.d40_sent = 0 AND e.start_date IS NOT NULL AND e.start_date >= ? AND e.start_date <= ?
          ORDER BY e.start_date, s.order_no`,
      )
      .all(t, addDays(t, EXAM_ALERT_DAYS)),
  ).filter((e) => catOf(e.kind) === "ex");
  if (!due.length) return;
  const body = due.map((e) => `${e.school} ${e.kind} ${rangeText({ grades: e.grades, from: e.from, to: e.to })} D-${daysBetween(t, e.from)}`).join(" · ");
  transaction(() => {
    for (const id of userIdsWithRole("ADMIN")) notify(id, "SCHOOL_EXAM", "📚 시험대비 일정 세워주세요", body, "/school");
    const mark = db.prepare("UPDATE school_events SET d40_sent = 1 WHERE id = ?");
    for (const e of due) mark.run(e.id);
  });
}
