// ★ 서버 전용. 클라이언트 컴포넌트에서 import 금지.
// 모든 도메인 쿼리와 기준정보 CRUD가 여기에 모인다. DB 접근은 이 파일에서만 한다.

import { getDb } from "./db";
import { rebuildSrForDay } from "./seed";
import { AppError, assert } from "./errors";
import { detectConflicts, type ConflictSession } from "./conflicts";
import { movableSeats, SEATS, type SeatUse } from "./sr";
import { toHHMM } from "./time";
import type {
  AttendanceEvent,
  AttendanceRecord,
  AttStatus,
  ClassRow,
  Conflict,
  Department,
  Notice,
  Notification,
  Room,
  SessionType,
  SessionUser,
  SrAssignment,
  StaffUser,
  Stage,
  Student,
  Task,
  TimetableSession,
} from "./types";

// node:sqlite 는 null 프로토타입 객체를 돌려준다.
// 그대로 클라이언트 컴포넌트에 넘기면 React 가 거부하므로 평범한 객체로 복사한다.
const rows = <T>(v: unknown): T[] => (v as T[]).map((r) => ({ ...r }));
const row = <T>(v: unknown): T | undefined =>
  v === undefined || v === null ? undefined : ({ ...(v as T) } as T);
const nowIso = () => new Date().toISOString();

/** dept 필터는 "ALL" 문자열을 쓴다. null/undefined 도 전체로 본다. */
export type DeptFilter = Department | "ALL" | null;

function deptWhere(column: string, dept: DeptFilter): { sql: string; args: string[] } {
  if (!dept || dept === "ALL") return { sql: "", args: [] };
  return { sql: ` AND ${column} = ?`, args: [dept] };
}

/* ------------------------------------------------------------------ 강의실 */

export function listRooms(): Room[] {
  return rows<Room>(
    getDb()
      .prepare("SELECT id, name, order_no AS orderNo, is_sr AS isSr FROM rooms ORDER BY order_no, id")
      .all(),
  );
}

export function createRoom(name: string): number {
  const trimmed = name.trim();
  assert(trimmed, "강의실 이름을 입력해 주세요.");
  const db = getDb();
  const max = row<{ n: number | null }>(
    db.prepare("SELECT MAX(order_no) AS n FROM rooms").get(),
  );
  const r = db
    .prepare("INSERT INTO rooms (name, order_no, is_sr) VALUES (?, ?, 0)")
    .run(trimmed, (max?.n ?? 0) + 1);
  return Number(r.lastInsertRowid);
}

export function updateRoom(id: number, name: string): void {
  const trimmed = name.trim();
  assert(trimmed, "강의실 이름을 입력해 주세요.");
  getDb().prepare("UPDATE rooms SET name = ? WHERE id = ?").run(trimmed, id);
}

export function deleteRoom(id: number): void {
  const db = getDb();
  const target = row<Room>(
    db.prepare("SELECT id, name, order_no AS orderNo, is_sr AS isSr FROM rooms WHERE id = ?").get(id),
  );
  assert(target, "강의실을 찾을 수 없습니다.");
  assert(target.isSr !== 1, "SR룸은 삭제할 수 없습니다.");
  const used = row<{ n: number }>(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM timetable_sessions WHERE room_id = ? OR alpha_room_id = ?",
      )
      .get(id, id),
  );
  assert((used?.n ?? 0) === 0, "이 강의실을 쓰는 시간표가 있어 삭제할 수 없습니다.");
  db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
}

/** move: -1 왼쪽으로, 1 오른쪽으로 */
export function moveRoom(id: number, move: -1 | 1): void {
  const db = getDb();
  const all = listRooms();
  const idx = all.findIndex((r) => r.id === id);
  assert(idx >= 0, "강의실을 찾을 수 없습니다.");
  const swapWith = idx + move;
  assert(swapWith >= 0 && swapWith < all.length, "더 이상 옮길 수 없습니다.");
  const a = all[idx];
  const b = all[swapWith];
  const stmt = db.prepare("UPDATE rooms SET order_no = ? WHERE id = ?");
  stmt.run(b.orderNo, a.id);
  stmt.run(a.orderNo, b.id);
}

/* -------------------------------------------------------------------- 계정 */

export type UserRow = StaffUser;

export function listUsers(): UserRow[] {
  return rows<UserRow>(
    getDb()
      .prepare(
        `SELECT id, login_id AS loginId, name, role, department, active
           FROM users ORDER BY role, name`,
      )
      .all(),
  );
}

export function listTeachers(dept: DeptFilter = "ALL"): UserRow[] {
  const w = deptWhere("department", dept);
  return rows<UserRow>(
    getDb()
      .prepare(
        `SELECT id, login_id AS loginId, name, role, department, active
           FROM users WHERE active = 1 AND role IN ('TEACHER','ADMIN')${w.sql} ORDER BY name`,
      )
      .all(...w.args),
  );
}

export function createUser(input: {
  loginId: string;
  password: string;
  name: string;
  role: string;
  department: string;
}): number {
  const loginId = input.loginId.trim();
  assert(loginId, "아이디를 입력해 주세요.");
  assert(input.name.trim(), "이름을 입력해 주세요.");
  assert(input.password, "비밀번호를 입력해 주세요.");
  const db = getDb();
  const dup = row<{ n: number }>(
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE login_id = ?").get(loginId),
  );
  assert((dup?.n ?? 0) === 0, "이미 사용 중인 아이디입니다.");
  const r = db
    .prepare(
      "INSERT INTO users (login_id, password, name, role, department, active) VALUES (?, ?, ?, ?, ?, 1)",
    )
    .run(loginId, input.password, input.name.trim(), input.role, input.department);
  return Number(r.lastInsertRowid);
}

export function updateUser(
  id: number,
  input: { name?: string; role?: string; department?: string; password?: string; active?: number },
): void {
  const db = getDb();
  const cur = row<{ id: number }>(db.prepare("SELECT id FROM users WHERE id = ?").get(id));
  assert(cur, "계정을 찾을 수 없습니다.");
  if (input.name !== undefined) {
    assert(input.name.trim(), "이름을 입력해 주세요.");
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(input.name.trim(), id);
  }
  if (input.role !== undefined) db.prepare("UPDATE users SET role = ? WHERE id = ?").run(input.role, id);
  if (input.department !== undefined)
    db.prepare("UPDATE users SET department = ? WHERE id = ?").run(input.department, id);
  if (input.password) db.prepare("UPDATE users SET password = ? WHERE id = ?").run(input.password, id);
  if (input.active !== undefined)
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(input.active ? 1 : 0, id);
}

export function deleteUser(id: number, actingUserId: number): void {
  assert(id !== actingUserId, "본인 계정은 삭제할 수 없습니다.");
  const db = getDb();
  const admins = row<{ n: number }>(
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND active = 1").get(),
  );
  const target = row<{ role: string }>(db.prepare("SELECT role FROM users WHERE id = ?").get(id));
  assert(target, "계정을 찾을 수 없습니다.");
  if (target.role === "ADMIN") assert((admins?.n ?? 0) > 1, "관리자 계정이 하나뿐이라 삭제할 수 없습니다.");
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

/* ---------------------------------------------------------------------- 반 */

export function listClasses(dept: DeptFilter = "ALL"): ClassRow[] {
  const w = deptWhere("c.department", dept);
  return rows<ClassRow>(
    getDb()
      .prepare(
        `SELECT c.id, c.name, c.department, c.teacher_id AS teacherId, u.name AS teacherName,
                c.room_id AS roomId, r.name AS roomName, c.grade, c.textbook,
                (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.active = 1) AS studentCount
           FROM classes c
           LEFT JOIN users u ON u.id = c.teacher_id
           LEFT JOIN rooms r ON r.id = c.room_id
          WHERE 1 = 1${w.sql}
          ORDER BY c.department, c.name`,
      )
      .all(...w.args),
  );
}

/** 이름으로 찾고 없으면 만든다 — Combobox 의 "직접 입력(신규 생성)" 용 */
export function findOrCreateClass(name: string, department: Department): number {
  const trimmed = name.trim();
  assert(trimmed, "반 이름을 입력해 주세요.");
  const db = getDb();
  const found = row<{ id: number }>(
    db.prepare("SELECT id FROM classes WHERE name = ? AND department = ?").get(trimmed, department),
  );
  if (found) return found.id;
  return createClass({ name: trimmed, department });
}

export function createClass(input: {
  name: string;
  department: string;
  teacherId?: number | null;
  roomId?: number | null;
  grade?: string | null;
  textbook?: string | null;
}): number {
  const name = input.name.trim();
  assert(name, "반 이름을 입력해 주세요.");
  const db = getDb();
  const dup = row<{ n: number }>(
    db
      .prepare("SELECT COUNT(*) AS n FROM classes WHERE name = ? AND department = ?")
      .get(name, input.department),
  );
  assert((dup?.n ?? 0) === 0, "같은 부서에 같은 이름의 반이 이미 있습니다.");
  const r = db
    .prepare(
      "INSERT INTO classes (name, department, teacher_id, room_id, grade, textbook) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      name,
      input.department,
      input.teacherId ?? null,
      input.roomId ?? null,
      input.grade?.trim() || null,
      input.textbook?.trim() || null,
    );
  return Number(r.lastInsertRowid);
}

export function updateClass(
  id: number,
  input: {
    name?: string;
    department?: string;
    teacherId?: number | null;
    roomId?: number | null;
    grade?: string | null;
    textbook?: string | null;
  },
): void {
  const db = getDb();
  const cur = row<{ id: number }>(db.prepare("SELECT id FROM classes WHERE id = ?").get(id));
  assert(cur, "반을 찾을 수 없습니다.");
  if (input.name !== undefined) {
    assert(input.name.trim(), "반 이름을 입력해 주세요.");
    db.prepare("UPDATE classes SET name = ? WHERE id = ?").run(input.name.trim(), id);
  }
  if (input.department !== undefined) {
    db.prepare("UPDATE classes SET department = ? WHERE id = ?").run(input.department, id);
    db.prepare("UPDATE students SET department = ? WHERE class_id = ?").run(input.department, id);
  }
  if (input.teacherId !== undefined)
    db.prepare("UPDATE classes SET teacher_id = ? WHERE id = ?").run(input.teacherId ?? null, id);
  if (input.roomId !== undefined)
    db.prepare("UPDATE classes SET room_id = ? WHERE id = ?").run(input.roomId ?? null, id);
  if (input.grade !== undefined)
    db.prepare("UPDATE classes SET grade = ? WHERE id = ?").run(input.grade?.trim() || null, id);
  if (input.textbook !== undefined)
    db.prepare("UPDATE classes SET textbook = ? WHERE id = ?").run(input.textbook?.trim() || null, id);
}

export function deleteClass(id: number): void {
  const db = getDb();
  const days = rows<{ day_of_week: number }>(
    db.prepare("SELECT DISTINCT day_of_week FROM timetable_sessions WHERE class_id = ?").all(id),
  );
  db.prepare("DELETE FROM classes WHERE id = ?").run(id);
  for (const d of days) rebuildSrForDay(db, d.day_of_week);
}

/* -------------------------------------------------------------------- 학생 */

export function listStudents(dept: DeptFilter = "ALL", classId?: number | null): Student[] {
  const db = getDb();
  const w = deptWhere("s.department", dept);
  const args: (string | number)[] = [...w.args];
  let sql = `SELECT s.id, s.name, s.department, s.class_id AS classId, c.name AS className, s.active
               FROM students s LEFT JOIN classes c ON c.id = s.class_id
              WHERE s.active = 1${w.sql}`;
  if (classId) {
    sql += " AND s.class_id = ?";
    args.push(classId);
  }
  sql += " ORDER BY c.name, s.id";
  return rows<Student>(db.prepare(sql).all(...args));
}

export function createStudent(input: {
  name: string;
  department: string;
  classId?: number | null;
}): number {
  const name = input.name.trim();
  assert(name, "학생 이름을 입력해 주세요.");
  const db = getDb();
  const r = db
    .prepare("INSERT INTO students (name, department, class_id, active) VALUES (?, ?, ?, 1)")
    .run(name, input.department, input.classId ?? null);
  rebuildSrForClass(input.classId ?? null);
  return Number(r.lastInsertRowid);
}

export function updateStudent(
  id: number,
  input: { name?: string; classId?: number | null; department?: string },
): void {
  const db = getDb();
  const cur = row<{ class_id: number | null }>(
    db.prepare("SELECT class_id FROM students WHERE id = ?").get(id),
  );
  assert(cur, "학생을 찾을 수 없습니다.");
  if (input.name !== undefined) {
    assert(input.name.trim(), "학생 이름을 입력해 주세요.");
    db.prepare("UPDATE students SET name = ? WHERE id = ?").run(input.name.trim(), id);
  }
  if (input.department !== undefined)
    db.prepare("UPDATE students SET department = ? WHERE id = ?").run(input.department, id);
  if (input.classId !== undefined) {
    db.prepare("UPDATE students SET class_id = ? WHERE id = ?").run(input.classId ?? null, id);
    rebuildSrForClass(cur.class_id);
    rebuildSrForClass(input.classId ?? null);
  }
}

export function deleteStudent(id: number): void {
  const db = getDb();
  const cur = row<{ class_id: number | null }>(
    db.prepare("SELECT class_id FROM students WHERE id = ?").get(id),
  );
  db.prepare("DELETE FROM students WHERE id = ?").run(id);
  rebuildSrForClass(cur?.class_id ?? null);
}

/** 반이 수업하는 모든 요일의 SR 을 다시 계산한다 (수동 이동은 초기화된다 — 의도된 동작) */
function rebuildSrForClass(classId: number | null): void {
  if (!classId) return;
  const db = getDb();
  const days = rows<{ day_of_week: number }>(
    db.prepare("SELECT DISTINCT day_of_week FROM timetable_sessions WHERE class_id = ?").all(classId),
  );
  for (const d of days) rebuildSrForDay(db, d.day_of_week);
}

/* ------------------------------------------------------------------ 시간표 */

function sessionSelect(): string {
  return `SELECT s.id, s.day_of_week AS dayOfWeek, s.class_id AS classId, c.name AS className,
                 c.department, s.type, s.start_min AS startMin, s.end_min AS endMin,
                 s.alpha_start_min AS alphaStartMin, s.alpha_end_min AS alphaEndMin,
                 s.room_id AS roomId, r.name AS roomName,
                 s.alpha_room_id AS alphaRoomId, ar.name AS alphaRoomName,
                 s.teacher_id AS teacherId, u.name AS teacherName,
                 (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.active = 1) AS studentCount
            FROM timetable_sessions s
            JOIN classes c ON c.id = s.class_id
            LEFT JOIN rooms r ON r.id = s.room_id
            LEFT JOIN rooms ar ON ar.id = s.alpha_room_id
            LEFT JOIN users u ON u.id = s.teacher_id`;
}

export function listSessions(day: number, dept: DeptFilter = "ALL"): TimetableSession[] {
  const w = deptWhere("c.department", dept);
  return rows<TimetableSession>(
    getDb()
      .prepare(`${sessionSelect()} WHERE s.day_of_week = ?${w.sql} ORDER BY s.start_min, s.id`)
      .all(day, ...w.args),
  );
}

function studentIdsByClass(): Map<number, number[]> {
  const all = rows<{ id: number; class_id: number | null }>(
    getDb().prepare("SELECT id, class_id FROM students WHERE active = 1").all(),
  );
  const map = new Map<number, number[]>();
  for (const s of all) {
    if (s.class_id === null) continue;
    const list = map.get(s.class_id) ?? [];
    list.push(s.id);
    map.set(s.class_id, list);
  }
  return map;
}

export function conflictsForDay(day: number): Conflict[] {
  const sessions = listSessions(day, "ALL");
  const byClass = studentIdsByClass();
  const srRoomIds = new Set(listRooms().filter((r) => r.isSr === 1).map((r) => r.id));
  const input: ConflictSession[] = sessions.map((s) => ({
    id: s.id,
    classId: s.classId,
    className: s.className,
    startMin: s.startMin,
    endMin: s.endMin,
    alphaStartMin: s.alphaStartMin,
    alphaEndMin: s.alphaEndMin,
    roomId: s.roomId,
    roomName: s.roomName,
    alphaRoomId: s.alphaRoomId,
    alphaRoomName: s.alphaRoomName,
    teacherId: s.teacherId,
    teacherName: s.teacherName,
    studentIds: byClass.get(s.classId) ?? [],
  }));
  return detectConflicts(input, srRoomIds);
}

export type SessionInput = {
  dayOfWeek: number;
  classId: number;
  type: SessionType;
  startMin: number;
  endMin: number;
  alphaStartMin: number | null;
  alphaEndMin: number | null;
  roomId: number | null;
  alphaRoomId: number | null;
  teacherId: number | null;
};

function validateSession(input: SessionInput): void {
  assert(input.dayOfWeek >= 0 && input.dayOfWeek <= 6, "요일을 선택해 주세요.");
  assert(input.classId, "반을 선택해 주세요.");
  assert(input.endMin > input.startMin, "수업 종료시간은 시작시간보다 뒤여야 합니다.");
  if (input.alphaStartMin !== null || input.alphaEndMin !== null) {
    assert(
      input.alphaStartMin !== null && input.alphaEndMin !== null,
      "알파 시작시간과 종료시간을 모두 선택해 주세요.",
    );
    assert(input.alphaEndMin! > input.alphaStartMin!, "알파 종료시간은 시작시간보다 뒤여야 합니다.");
    assert(input.alphaRoomId !== null, "알파 강의실을 선택해 주세요.");
  }
}

export function createSession(input: SessionInput): number {
  validateSession(input);
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO timetable_sessions
        (day_of_week, class_id, type, start_min, end_min, alpha_start_min, alpha_end_min, room_id, alpha_room_id, teacher_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.dayOfWeek,
      input.classId,
      input.type,
      input.startMin,
      input.endMin,
      input.alphaStartMin,
      input.alphaEndMin,
      input.roomId,
      input.alphaRoomId,
      input.teacherId,
    );
  rebuildSrForDay(db, input.dayOfWeek);
  return Number(r.lastInsertRowid);
}

export function updateSession(id: number, input: SessionInput): void {
  validateSession(input);
  const db = getDb();
  const cur = row<{ day_of_week: number }>(
    db.prepare("SELECT day_of_week FROM timetable_sessions WHERE id = ?").get(id),
  );
  assert(cur, "수업을 찾을 수 없습니다.");
  db.prepare(
    `UPDATE timetable_sessions
        SET day_of_week = ?, class_id = ?, type = ?, start_min = ?, end_min = ?,
            alpha_start_min = ?, alpha_end_min = ?, room_id = ?, alpha_room_id = ?, teacher_id = ?
      WHERE id = ?`,
  ).run(
    input.dayOfWeek,
    input.classId,
    input.type,
    input.startMin,
    input.endMin,
    input.alphaStartMin,
    input.alphaEndMin,
    input.roomId,
    input.alphaRoomId,
    input.teacherId,
    id,
  );
  rebuildSrForDay(db, cur.day_of_week);
  if (cur.day_of_week !== input.dayOfWeek) rebuildSrForDay(db, input.dayOfWeek);
}

export function deleteSession(id: number): void {
  const db = getDb();
  const cur = row<{ day_of_week: number }>(
    db.prepare("SELECT day_of_week FROM timetable_sessions WHERE id = ?").get(id),
  );
  assert(cur, "수업을 찾을 수 없습니다.");
  db.prepare("DELETE FROM timetable_sessions WHERE id = ?").run(id);
  rebuildSrForDay(db, cur.day_of_week);
}

/* ---------------------------------------------------------------------- SR */

export function listSrAssignments(day: number, dept: DeptFilter = "ALL"): SrAssignment[] {
  const w = deptWhere("c.department", dept);
  return rows<SrAssignment>(
    getDb()
      .prepare(
        `SELECT a.id, a.session_id AS sessionId, a.student_id AS studentId, st.name AS studentName,
                c.id AS classId, c.name AS className, a.day_of_week AS dayOfWeek, a.seat,
                a.start_min AS startMin, a.end_min AS endMin, a.is_manual AS isManual
           FROM sr_assignments a
           JOIN students st ON st.id = a.student_id
           JOIN timetable_sessions s ON s.id = a.session_id
           JOIN classes c ON c.id = s.class_id
          WHERE a.day_of_week = ?${w.sql}
          ORDER BY a.seat`,
      )
      .all(day, ...w.args),
  );
}

/** 이동 가능 좌석 — 부서 필터와 무관하게 그 요일의 모든 배정을 본다 */
export function srMoveOptions(assignmentId: number): string[] {
  const db = getDb();
  const target = row<SeatUse & { day_of_week: number }>(
    db
      .prepare(
        `SELECT id, student_id AS studentId, seat, start_min AS startMin, end_min AS endMin, day_of_week
           FROM sr_assignments WHERE id = ?`,
      )
      .get(assignmentId),
  );
  assert(target, "좌석 배정을 찾을 수 없습니다.");
  const all = rows<SeatUse>(
    db
      .prepare(
        `SELECT id, student_id AS studentId, seat, start_min AS startMin, end_min AS endMin
           FROM sr_assignments WHERE day_of_week = ?`,
      )
      .all(target.day_of_week),
  );
  return movableSeats(target, all);
}

export function srMove(assignmentId: number, seat: string): void {
  assert(SEATS.includes(seat), "없는 좌석입니다.");
  const options = srMoveOptions(assignmentId);
  assert(
    options.includes(seat),
    "이 학생의 SR 이용시간 중에 다른 배정이 있어 옮길 수 없는 좌석입니다.",
  );
  getDb()
    .prepare("UPDATE sr_assignments SET seat = ?, is_manual = 1 WHERE id = ?")
    .run(seat, assignmentId);
}

/** 그 요일 전체를 자동배정으로 되돌린다 (수동 이동 초기화) */
export function srReset(day: number): void {
  rebuildSrForDay(getDb(), day);
}

/* -------------------------------------------------------------------- 출결 */

const ATT_EVENT_SELECT = `SELECT e.id, e.session_id AS sessionId, e.date, e.stage,
        c.name AS className, c.department, s.teacher_id AS teacherId, u.name AS teacherName,
        r.name AS roomName, s.day_of_week AS dayOfWeek, s.start_min AS startMin, s.end_min AS endMin
   FROM attendance_events e
   JOIN timetable_sessions s ON s.id = e.session_id
   JOIN classes c ON c.id = s.class_id
   LEFT JOIN rooms r ON r.id = s.room_id
   LEFT JOIN users u ON u.id = s.teacher_id`;

type EventHead = Omit<AttendanceEvent, "records">;

function attachRecords(heads: EventHead[]): AttendanceEvent[] {
  if (heads.length === 0) return [];
  const db = getDb();
  const stmt = db.prepare(
    `SELECT r.id, r.student_id AS studentId, st.name AS studentName, r.status,
            r.absent_reason AS absentReason, r.late_reason AS lateReason, r.eta
       FROM attendance_records r
       JOIN students st ON st.id = r.student_id
      WHERE r.event_id = ?
      ORDER BY st.id`,
  );
  return heads.map((h) => ({ ...h, records: rows<AttendanceRecord>(stmt.all(h.id)) }));
}

function notify(userId: number, kind: string, title: string, body: string, link: string): void {
  getDb()
    .prepare(
      "INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(userId, kind, title, body, link, nowIso());
}

function openEvent(sessionId: number, date: string): number | null {
  const db = getDb();
  const exists = row<{ id: number }>(
    db.prepare("SELECT id FROM attendance_events WHERE session_id = ? AND date = ?").get(sessionId, date),
  );
  if (exists) return null;

  const s = row<{ class_id: number; teacher_id: number | null; class_name: string; start_min: number; end_min: number }>(
    db
      .prepare(
        `SELECT s.class_id, s.teacher_id, c.name AS class_name, s.start_min, s.end_min
           FROM timetable_sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      )
      .get(sessionId),
  );
  if (!s) return null;

  const now = nowIso();
  const r = db
    .prepare(
      "INSERT INTO attendance_events (session_id, date, stage, created_at, updated_at) VALUES (?, ?, 'TEACHER_PENDING', ?, ?)",
    )
    .run(sessionId, date, now, now);
  const eventId = Number(r.lastInsertRowid);

  const students = rows<{ id: number }>(
    db.prepare("SELECT id FROM students WHERE class_id = ? AND active = 1 ORDER BY id").all(s.class_id),
  );
  const ins = db.prepare(
    "INSERT INTO attendance_records (event_id, student_id, status) VALUES (?, ?, 'UNCHECKED')",
  );
  for (const st of students) ins.run(eventId, st.id);

  if (s.teacher_id) {
    notify(
      s.teacher_id,
      "ATTENDANCE_TEACHER",
      "출석체크해주세요.",
      `${s.class_name} ${toHHMM(s.start_min)}~${toHHMM(s.end_min)}`,
      "/attendance",
    );
  }
  return eventId;
}

/**
 * 폴링 시점 tick — 수업 시작 +2분이 지난 수업의 출결을 연다.
 * 아무도 앱을 켜두지 않으면 그 시간 이벤트가 안 열린다(알려진 한계).
 */
export function tickAttendance(date: string, dayOfWeek: number, nowMin: number): void {
  const due = rows<{ id: number }>(
    getDb()
      .prepare(
        `SELECT s.id FROM timetable_sessions s
          WHERE s.day_of_week = ? AND s.start_min + 2 <= ? AND s.end_min > ?
            AND NOT EXISTS (SELECT 1 FROM attendance_events e WHERE e.session_id = s.id AND e.date = ?)`,
      )
      .all(dayOfWeek, nowMin, nowMin - 120, date),
  );
  for (const s of due) openEvent(s.id, date);
}

/** 결석관리의 "지금 열기" — 시작 +2분을 기다리지 않고 즉시 시작 */
export function triggerAttendance(sessionId: number, date: string): void {
  const created = openEvent(sessionId, date);
  assert(created !== null, "이미 열려 있는 출결입니다.");
}

export function pendingForUser(user: SessionUser, date: string): AttendanceEvent[] {
  const db = getDb();
  let sql = `${ATT_EVENT_SELECT} WHERE e.date = ? AND e.stage <> 'DONE'`;
  const args: (string | number)[] = [date];

  if (user.role === "TEACHER") {
    sql += " AND s.teacher_id = ? AND e.stage IN ('TEACHER_PENDING','TEACHER_CONFIRM')";
    args.push(user.id);
  } else if (user.role === "DESK") {
    sql += " AND e.stage = 'DESK_PENDING'";
  }
  sql += " ORDER BY s.start_min";

  return attachRecords(rows<EventHead>(db.prepare(sql).all(...args)));
}

export function listAttendance(date: string, dept: DeptFilter = "ALL"): AttendanceEvent[] {
  const w = deptWhere("c.department", dept);
  return attachRecords(
    rows<EventHead>(
      getDb()
        .prepare(`${ATT_EVENT_SELECT} WHERE e.date = ?${w.sql} ORDER BY s.start_min`)
        .all(date, ...w.args),
    ),
  );
}

/** 아직 열리지 않은 그 날의 수업 (결석관리의 "지금 열기" 후보) */
export function notOpenedSessions(date: string, dayOfWeek: number, dept: DeptFilter = "ALL"): TimetableSession[] {
  const w = deptWhere("c.department", dept);
  return rows<TimetableSession>(
    getDb()
      .prepare(
        `${sessionSelect()}
          WHERE s.day_of_week = ?${w.sql}
            AND NOT EXISTS (SELECT 1 FROM attendance_events e WHERE e.session_id = s.id AND e.date = ?)
          ORDER BY s.start_min`,
      )
      .all(dayOfWeek, ...w.args, date),
  );
}

export type SubmitRecord = {
  studentId: number;
  status: AttStatus;
  absentReason?: string | null;
  lateReason?: string | null;
  eta?: string | null;
};

export function submitAttendance(
  user: SessionUser,
  eventId: number,
  step: "TEACHER" | "DESK" | "CONFIRM",
  records: SubmitRecord[],
): void {
  const db = getDb();
  const ev = row<{ id: number; stage: Stage; teacher_id: number | null; class_name: string; start_min: number; end_min: number; date: string }>(
    db
      .prepare(
        `SELECT e.id, e.stage, e.date, s.teacher_id, c.name AS class_name, s.start_min, s.end_min
           FROM attendance_events e
           JOIN timetable_sessions s ON s.id = e.session_id
           JOIN classes c ON c.id = s.class_id
          WHERE e.id = ?`,
      )
      .get(eventId),
  );
  assert(ev, "출결 정보를 찾을 수 없습니다.");

  const isOwnClass = ev.teacher_id === user.id;
  const label = `${ev.class_name} ${toHHMM(ev.start_min)}~${toHHMM(ev.end_min)}`;

  if (step === "TEACHER") {
    assert(ev.stage === "TEACHER_PENDING", "이미 제출된 출석체크입니다.");
    assert(
      user.role === "ADMIN" || (user.role === "TEACHER" && isOwnClass),
      "담당 선생님만 출석체크를 제출할 수 있습니다.",
    );
    for (const r of records) {
      assert(
        r.status !== "ABSENT" || (r.absentReason && r.absentReason.trim()),
        "결석 사유를 입력해 주세요.",
      );
    }
    const stmt = db.prepare(
      "UPDATE attendance_records SET status = ?, absent_reason = ? WHERE event_id = ? AND student_id = ?",
    );
    for (const r of records) {
      stmt.run(r.status, r.status === "ABSENT" ? (r.absentReason ?? "").trim() : null, eventId, r.studentId);
    }
    db.prepare("UPDATE attendance_events SET stage = 'DESK_PENDING', updated_at = ? WHERE id = ?").run(
      nowIso(),
      eventId,
    );
    for (const d of rows<{ id: number }>(
      db.prepare("SELECT id FROM users WHERE role = 'DESK' AND active = 1").all(),
    )) {
      notify(d.id, "ATTENDANCE_DESK", "출결전화 돌려주세요.", label, "/attendance");
    }
    return;
  }

  if (step === "DESK") {
    assert(ev.stage === "DESK_PENDING", "이미 저장된 출결전화입니다.");
    assert(user.role === "ADMIN" || user.role === "DESK", "데스크만 출결전화를 저장할 수 있습니다.");
    const stmt = db.prepare(
      "UPDATE attendance_records SET status = ?, late_reason = ?, eta = ? WHERE event_id = ? AND student_id = ?",
    );
    for (const r of records) {
      const lateReason = r.lateReason?.trim() || null;
      const eta = r.eta?.trim() || null;
      // 지각 사유나 도착예정시간을 입력하면 자동으로 지각 처리한다
      const status: AttStatus = lateReason || eta ? "LATE" : r.status;
      stmt.run(status, lateReason, eta, eventId, r.studentId);
    }
    db.prepare("UPDATE attendance_events SET stage = 'TEACHER_CONFIRM', updated_at = ? WHERE id = ?").run(
      nowIso(),
      eventId,
    );
    if (ev.teacher_id) {
      notify(ev.teacher_id, "ATTENDANCE_CONFIRM", "출결사항 확인해주세요.", label, "/attendance");
    }
    return;
  }

  assert(ev.stage === "TEACHER_CONFIRM", "확인할 단계가 아닙니다.");
  assert(
    user.role === "ADMIN" || (user.role === "TEACHER" && isOwnClass),
    "담당 선생님만 최종 확인할 수 있습니다.",
  );
  db.prepare("UPDATE attendance_events SET stage = 'DONE', updated_at = ? WHERE id = ?").run(
    nowIso(),
    eventId,
  );
}

export function attendanceSummary(date: string, dept: DeptFilter = "ALL") {
  const events = listAttendance(date, dept);
  const byStage: Record<Stage, number> = {
    TEACHER_PENDING: 0,
    DESK_PENDING: 0,
    TEACHER_CONFIRM: 0,
    DONE: 0,
  };
  let present = 0;
  let absent = 0;
  let late = 0;
  let unchecked = 0;
  for (const e of events) {
    byStage[e.stage] += 1;
    for (const r of e.records) {
      if (r.status === "PRESENT") present += 1;
      else if (r.status === "ABSENT") absent += 1;
      else if (r.status === "LATE") late += 1;
      else unchecked += 1;
    }
  }
  return { total: events.length, byStage, present, absent, late, unchecked };
}

/* -------------------------------------------------------------- 알림/공지/업무 */

export function listNotifications(userId: number, limit = 30): Notification[] {
  return rows<Notification>(
    getDb()
      .prepare(
        `SELECT id, kind, title, body, link, read_at AS readAt, created_at AS createdAt
           FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(userId, limit),
  );
}

export function unreadCount(userId: number): number {
  return (
    row<{ n: number }>(
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL")
        .get(userId),
    )?.n ?? 0
  );
}

export function markNotificationsRead(userId: number): void {
  getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
    .run(nowIso(), userId);
}

export function listNotices(dept: DeptFilter = "ALL", limit = 50): Notice[] {
  const db = getDb();
  const args: (string | number)[] = [];
  let sql = `SELECT n.id, n.title, n.body, n.department, n.author_id AS authorId, u.name AS authorName,
                    n.created_at AS createdAt
               FROM notices n LEFT JOIN users u ON u.id = n.author_id WHERE 1 = 1`;
  if (dept && dept !== "ALL") {
    sql += " AND (n.department = ? OR n.department = 'ALL')";
    args.push(dept);
  }
  sql += " ORDER BY n.id DESC LIMIT ?";
  args.push(limit);
  return rows<Notice>(db.prepare(sql).all(...args));
}

export function createNotice(input: {
  title: string;
  body: string;
  department: string;
  authorId: number;
}): number {
  assert(input.title.trim(), "공지 제목을 입력해 주세요.");
  assert(input.body.trim(), "공지 내용을 입력해 주세요.");
  const db = getDb();
  const r = db
    .prepare(
      "INSERT INTO notices (title, body, department, author_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.title.trim(), input.body.trim(), input.department, input.authorId, nowIso());

  const targets =
    input.department === "ALL"
      ? rows<{ id: number }>(db.prepare("SELECT id FROM users WHERE active = 1").all())
      : rows<{ id: number }>(
          db.prepare("SELECT id FROM users WHERE active = 1 AND department = ?").all(input.department),
        );
  for (const t of targets) notify(t.id, "NOTICE", "새 공지가 등록되었습니다.", input.title.trim(), "/notices");
  return Number(r.lastInsertRowid);
}

export function listTasks(opts: { assigneeId?: number; all?: boolean }): Task[] {
  const db = getDb();
  const args: (string | number)[] = [];
  let sql = `SELECT t.id, t.assignee_id AS assigneeId, a.name AS assigneeName, t.created_by AS createdBy,
                    b.name AS createdByName, t.title, t.done, t.due_date AS dueDate, t.created_at AS createdAt
               FROM tasks t
               JOIN users a ON a.id = t.assignee_id
               LEFT JOIN users b ON b.id = t.created_by
              WHERE 1 = 1`;
  if (!opts.all && opts.assigneeId) {
    sql += " AND t.assignee_id = ?";
    args.push(opts.assigneeId);
  }
  sql += " ORDER BY t.done, t.id DESC";
  return rows<Task>(db.prepare(sql).all(...args));
}

export function createTask(input: {
  assigneeId: number;
  createdBy: number;
  title: string;
  dueDate?: string | null;
}): number {
  assert(input.title.trim(), "업무 내용을 입력해 주세요.");
  assert(input.assigneeId, "담당자를 선택해 주세요.");
  const db = getDb();
  const r = db
    .prepare(
      "INSERT INTO tasks (assignee_id, created_by, title, done, due_date, created_at) VALUES (?, ?, ?, 0, ?, ?)",
    )
    .run(input.assigneeId, input.createdBy, input.title.trim(), input.dueDate || null, nowIso());
  notify(input.assigneeId, "TASK", "새 업무가 지시되었습니다.", input.title.trim(), "/tasks");
  return Number(r.lastInsertRowid);
}

export function setTaskDone(id: number, done: boolean, user: SessionUser): void {
  const db = getDb();
  const t = row<{ assignee_id: number }>(db.prepare("SELECT assignee_id FROM tasks WHERE id = ?").get(id));
  assert(t, "업무를 찾을 수 없습니다.");
  assert(user.role === "ADMIN" || t.assignee_id === user.id, "내 업무만 체크할 수 있습니다.");
  db.prepare("UPDATE tasks SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
}

export function deleteTask(id: number): void {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

/* ---------------------------------------------------------------- 대시보드 */

export type ScheduleItem = {
  startMin: number;
  endMin: number;
  title: string;
  subtitle: string;
};

/** 오늘의 일정 — 선생님은 담당 수업, 관리자·데스크는 전체 */
export function todaySchedule(user: SessionUser, dayOfWeek: number): ScheduleItem[] {
  const sessions = listSessions(dayOfWeek, "ALL");
  const mine = user.role === "TEACHER" ? sessions.filter((s) => s.teacherId === user.id) : sessions;
  const items: ScheduleItem[] = [];
  for (const s of mine) {
    items.push({
      startMin: s.startMin,
      endMin: s.endMin,
      title: `${s.className} 수업`,
      subtitle: [s.roomName, s.teacherName ? `${s.teacherName} 선생님` : null].filter(Boolean).join(" · "),
    });
    if (s.alphaStartMin !== null && s.alphaEndMin !== null) {
      items.push({
        startMin: s.alphaStartMin,
        endMin: s.alphaEndMin,
        title: `${s.className} 알파`,
        subtitle: s.alphaRoomName ?? "SR룸",
      });
    }
  }
  return items.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}
