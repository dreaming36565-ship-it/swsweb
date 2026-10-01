// ★ 서버 전용. 📝 상담기록 — 고등부 선생님이 가르치는 학생(중3 포함)의 상담.
// 쓰기 · 전부 보기 = 고등부 선생님 · 데스크(정직원) · 관리자 / 초중등부 선생님 = 중등 학생 기록만 보기 (perm.ts counselAccess).
// 고치기 · 지우기 = 쓴 사람 + 관리자.

import { getDb } from "../db";
import { AppError, assert } from "../errors";
import { counselAccess } from "../perm";
import { gradeLevel } from "../sr";
import { COUNSEL_HOW, COUNSEL_KIND, COUNSEL_ROLE, COUNSEL_TARGET, COUNSEL_TOPIC } from "../counsel";
import type { SessionUser } from "../types";
import { nowIso, row, rows } from "./base";

export type CounselStudent = { id: number; name: string; className: string; grade: string | null; level: "M" | "H" };
export type Counsel = {
  id: number;
  date: string;
  authorId: number | null;
  authorName: string;
  studentId: number | null;
  studentName: string;
  className: string | null;
  grade: string | null;
  level: "M" | "H";
  kind: string;
  how: string;
  target: string;
  topic: string;
  role: string;
  text: string;
  updatedAt: string;
};
export type CounselData = { access: "WRITE" | "MIDDLE"; students: CounselStudent[]; records: Counsel[] };

function accessOf(user: SessionUser): "WRITE" | "MIDDLE" {
  const a = counselAccess(user);
  if (!a) throw new AppError("상담기록은 고등부 선생님 · 데스크(정직원) · 관리자만 볼 수 있어요.", 403);
  return a;
}

/** 고등부 선생님이 가르치는 반(반 담당 또는 수업 칸 담당)의 학생 — 중등 · 고등 */
export function counselStudents(): CounselStudent[] {
  const list = rows<{ id: number; name: string; class_name: string; grade: string | null; level: string | null; type: string | null }>(
    getDb()
      .prepare(
        `SELECT DISTINCT st.id, st.name, c.name AS class_name, c.grade, c.level,
                (SELECT type FROM timetable_sessions WHERE class_id = c.id LIMIT 1) AS type
           FROM classes c
           JOIN student_classes sc ON sc.class_id = c.id
           JOIN students st ON st.id = sc.student_id AND st.active = 1
          WHERE c.teacher_id IN (SELECT id FROM users WHERE department = 'HIGH' AND active = 1)
             OR c.id IN (SELECT ts.class_id FROM timetable_sessions ts JOIN users u ON u.id = ts.teacher_id WHERE u.department = 'HIGH')
          ORDER BY st.name, c.name`,
      )
      .all(),
  );
  // 학생마다 반 하나 — 정규반을 먼저 (누적오답 · 개별반은 학교급이 애매해서 뒤로)
  const out = new Map<number, CounselStudent>();
  const rank = (t: string | null) => (t === "REVIEW" || t === "INDIVIDUAL" || t === "HOMEWORK" ? 1 : 0);
  for (const r of [...list].sort((a, b) => rank(a.type) - rank(b.type))) {
    if (out.has(r.id)) continue;
    const lv = gradeLevel(r.grade, r.level);
    if (lv !== "M" && lv !== "H") continue;
    out.set(r.id, { id: r.id, name: r.name, className: r.class_name, grade: r.grade, level: lv });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

const SELECT = `SELECT id, date, author_id AS authorId, author_name AS authorName, student_id AS studentId, student_name AS studentName,
       class_name AS className, grade, level, kind, how, target, topic, role, text, updated_at AS updatedAt FROM counsels`;

export function counselData(user: SessionUser, from: string, to: string): CounselData {
  const access = accessOf(user);
  const records = rows<Counsel>(
    getDb()
      .prepare(`${SELECT} WHERE date BETWEEN ? AND ?${access === "MIDDLE" ? " AND level = 'M'" : ""} ORDER BY date, id`)
      .all(from, to),
  );
  const students = counselStudents().filter((s) => access === "WRITE" || s.level === "M");
  return { access, students, records };
}

/** 👤 학생별 — 그 학생의 상담 전부 (기간 상관없이) */
export function counselsOfStudent(user: SessionUser, studentId: number): Counsel[] {
  const access = accessOf(user);
  return rows<Counsel>(
    getDb()
      .prepare(`${SELECT} WHERE student_id = ?${access === "MIDDLE" ? " AND level = 'M'" : ""} ORDER BY date DESC, id DESC`)
      .all(studentId),
  );
}

export type CounselInput = {
  id?: number;
  date: string;
  studentId: number;
  kind: string;
  how: string;
  target: string;
  topic: string;
  role: string;
  text: string;
};

const oneOf = (v: string, list: readonly string[], label: string) => assert(list.includes(v), `${label}을(를) 골라 주세요.`);

export function saveCounsel(user: SessionUser, input: CounselInput): number {
  assert(accessOf(user) === "WRITE", "상담기록은 고등부 선생님 · 데스크(정직원) · 관리자만 쓸 수 있어요.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? ""), "상담일자를 골라 주세요.");
  oneOf(input.kind, COUNSEL_KIND, "구분");
  oneOf(input.how, COUNSEL_HOW, "상담방법");
  oneOf(input.target, COUNSEL_TARGET, "상담대상");
  oneOf(input.topic, COUNSEL_TOPIC, "상담주제");
  oneOf(input.role, COUNSEL_ROLE, "상담강사");
  const text = (input.text ?? "").trim();
  assert(text, "상담내용을 적어 주세요.");
  assert(text.length <= 5000, "상담내용은 5,000자까지예요.");
  const db = getDb();
  const now = nowIso();
  if (input.id) {
    const cur = row<{ author_id: number | null }>(db.prepare("SELECT author_id FROM counsels WHERE id = ?").get(input.id));
    assert(cur, "상담기록을 찾을 수 없어요. 화면을 새로고침해 주세요.");
    assert(cur.author_id === user.id || user.roles.includes("ADMIN"), "고치기는 쓴 사람과 관리자만 할 수 있어요.");
    db.prepare("UPDATE counsels SET date = ?, kind = ?, how = ?, target = ?, topic = ?, role = ?, text = ?, updated_at = ? WHERE id = ?").run(
      input.date,
      input.kind,
      input.how,
      input.target,
      input.topic,
      input.role,
      text,
      now,
      input.id,
    );
    return input.id;
  }
  const st = counselStudents().find((s) => s.id === input.studentId);
  assert(st, "학생을 목록에서 골라 주세요. (고등부 선생님이 가르치는 반 학생만)");
  return Number(
    db
      .prepare(
        `INSERT INTO counsels (date, author_id, author_name, student_id, student_name, class_name, grade, level, kind, how, target, topic, role, text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.date, user.id, user.name, st.id, st.name, st.className, st.grade, st.level, input.kind, input.how, input.target, input.topic, input.role, text, now, now)
      .lastInsertRowid,
  );
}

export function deleteCounsel(user: SessionUser, id: number): void {
  assert(accessOf(user) === "WRITE", "상담기록을 지울 권한이 없어요.");
  const db = getDb();
  const cur = row<{ author_id: number | null }>(db.prepare("SELECT author_id FROM counsels WHERE id = ?").get(id));
  assert(cur, "상담기록을 찾을 수 없어요. 화면을 새로고침해 주세요.");
  assert(cur.author_id === user.id || user.roles.includes("ADMIN"), "지우기는 쓴 사람과 관리자만 할 수 있어요.");
  db.prepare("DELETE FROM counsels WHERE id = ?").run(id);
}
