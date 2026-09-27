// ★ 서버 전용. 클라이언트 컴포넌트에서 import 금지.
// 모든 도메인 쿼리와 기준정보 CRUD가 여기에 모인다. DB 접근은 이 파일에서만 한다.

import { getDb } from "./db";
import { rebuildSrForDay } from "./seed";
import { AppError, assert } from "./errors";
import { detectConflicts, type ConflictSession } from "./conflicts";
import { movableSeats, SEATS, type SeatUse } from "./sr";
import { dateKey, fmtTime, minutesOfDay, rangeLabel } from "./time";
import {
  callStateOf,
  canMarkAbsent,
  finalStatus,
  isRemaining,
  needsInfo,
  normalizeCall,
  triggerOf,
} from "./attendance";
import type {
  AttendanceEvent,
  AttendanceGroup,
  AttendanceRecord,
  AttStatus,
  CallState,
  Checker,
  ClassRow,
  Conflict,
  Department,
  Makeup,
  MakeupStatus,
  Notice,
  Notification,
  PendingAbsence,
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

/** 여러 줄을 한 번에 바꿀 때 — 중간에 실패하면 전부 되돌린다 */
function transaction(fn: () => void): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

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
                (SELECT COUNT(*) FROM student_classes sc JOIN students s ON s.id = sc.student_id
                  WHERE sc.class_id = c.id AND s.active = 1) AS studentCount
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
    db.prepare(
      "UPDATE students SET department = ? WHERE id IN (SELECT student_id FROM student_classes WHERE class_id = ?)",
    ).run(input.department, id);
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
  let sql = `SELECT s.id, s.name, s.department, s.active
               FROM students s
              WHERE s.active = 1${w.sql}`;
  if (classId) {
    sql += " AND EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = s.id AND sc.class_id = ?)";
    args.push(classId);
  }
  sql += " ORDER BY s.name, s.id";
  const list = rows<Omit<Student, "classIds" | "classNames">>(db.prepare(sql).all(...args));

  // 소속 반은 따로 모아서 붙인다 (정규반 먼저, 개별반 나중 — 이름순)
  const memberships = rows<{ student_id: number; class_id: number; class_name: string }>(
    db
      .prepare(
        `SELECT sc.student_id, sc.class_id, c.name AS class_name
           FROM student_classes sc JOIN classes c ON c.id = sc.class_id
          ORDER BY c.name`,
      )
      .all(),
  );
  const byStudent = new Map<number, { ids: number[]; names: string[] }>();
  for (const m of memberships) {
    const cur = byStudent.get(m.student_id) ?? { ids: [], names: [] };
    cur.ids.push(m.class_id);
    cur.names.push(m.class_name);
    byStudent.set(m.student_id, cur);
  }
  return list.map((s) => ({
    ...s,
    classIds: byStudent.get(s.id)?.ids ?? [],
    classNames: byStudent.get(s.id)?.names ?? [],
  }));
}

function classIdsOf(studentId: number): number[] {
  return rows<{ class_id: number }>(
    getDb().prepare("SELECT class_id FROM student_classes WHERE student_id = ?").all(studentId),
  ).map((r) => r.class_id);
}

export function createStudent(input: {
  name: string;
  department: string;
  classIds?: number[];
}): number {
  const name = input.name.trim();
  assert(name, "학생 이름을 입력해 주세요.");
  const db = getDb();
  const r = db
    .prepare("INSERT INTO students (name, department, active) VALUES (?, ?, 1)")
    .run(name, input.department);
  const id = Number(r.lastInsertRowid);
  const classIds = input.classIds ?? [];
  const ins = db.prepare("INSERT OR IGNORE INTO student_classes (student_id, class_id) VALUES (?, ?)");
  for (const c of classIds) ins.run(id, c);
  rebuildSrForClasses(classIds);
  return id;
}

export function updateStudent(
  id: number,
  input: { name?: string; department?: string },
): void {
  const db = getDb();
  const cur = row<{ id: number }>(db.prepare("SELECT id FROM students WHERE id = ?").get(id));
  assert(cur, "학생을 찾을 수 없습니다.");
  if (input.name !== undefined) {
    assert(input.name.trim(), "학생 이름을 입력해 주세요.");
    db.prepare("UPDATE students SET name = ? WHERE id = ?").run(input.name.trim(), id);
  }
  if (input.department !== undefined)
    db.prepare("UPDATE students SET department = ? WHERE id = ?").run(input.department, id);
}

/** 기존 학생을 다른 반에도 넣는다 (예: 정규반 학생을 개별반에 추가) */
export function addStudentToClass(studentId: number, classId: number): void {
  const db = getDb();
  const st = row<{ id: number }>(db.prepare("SELECT id FROM students WHERE id = ?").get(studentId));
  assert(st, "학생을 찾을 수 없습니다.");
  const cls = row<{ id: number }>(db.prepare("SELECT id FROM classes WHERE id = ?").get(classId));
  assert(cls, "반을 찾을 수 없습니다.");
  const dup = row<{ n: number }>(
    db
      .prepare("SELECT COUNT(*) AS n FROM student_classes WHERE student_id = ? AND class_id = ?")
      .get(studentId, classId),
  );
  assert((dup?.n ?? 0) === 0, "이미 이 반에 있는 학생입니다.");
  db.prepare("INSERT INTO student_classes (student_id, class_id) VALUES (?, ?)").run(studentId, classId);
  rebuildSrForClasses([classId]);
}

/** 이 반에서만 뺀다. 다른 반 소속과 학생 정보는 그대로 남는다. */
export function removeStudentFromClass(studentId: number, classId: number): void {
  getDb()
    .prepare("DELETE FROM student_classes WHERE student_id = ? AND class_id = ?")
    .run(studentId, classId);
  rebuildSrForClasses([classId]);
}

export function deleteStudent(id: number): void {
  const db = getDb();
  const classIds = classIdsOf(id);
  db.prepare("DELETE FROM students WHERE id = ?").run(id);
  rebuildSrForClasses(classIds);
}

/** 반들이 수업하는 모든 요일의 SR 을 다시 계산한다 (수동 이동은 초기화된다 — 의도된 동작) */
function rebuildSrForClasses(classIds: number[]): void {
  if (classIds.length === 0) return;
  const db = getDb();
  const days = new Set<number>();
  const stmt = db.prepare("SELECT DISTINCT day_of_week FROM timetable_sessions WHERE class_id = ?");
  for (const c of classIds) {
    for (const d of rows<{ day_of_week: number }>(stmt.all(c))) days.add(d.day_of_week);
  }
  for (const d of days) rebuildSrForDay(db, d);
}

/* ------------------------------------------------------------------ 시간표 */

function sessionSelect(): string {
  return `SELECT s.id, s.day_of_week AS dayOfWeek, s.class_id AS classId, c.name AS className,
                 c.department, s.type, s.start_min AS startMin, s.end_min AS endMin,
                 s.alpha_start_min AS alphaStartMin, s.alpha_end_min AS alphaEndMin,
                 s.room_id AS roomId, r.name AS roomName,
                 s.alpha_room_id AS alphaRoomId, ar.name AS alphaRoomName,
                 s.teacher_id AS teacherId, u.name AS teacherName,
                 (SELECT COUNT(*) FROM student_classes sc JOIN students st ON st.id = sc.student_id
                   WHERE sc.class_id = c.id AND st.active = 1) AS studentCount
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
  const all = rows<{ id: number; class_id: number }>(
    getDb()
      .prepare(
        `SELECT s.id, sc.class_id FROM student_classes sc
           JOIN students s ON s.id = sc.student_id WHERE s.active = 1`,
      )
      .all(),
  );
  const map = new Map<number, number[]>();
  for (const s of all) {
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

const ATT_EVENT_SELECT = `SELECT e.id, e.session_id AS sessionId, e.date, e.stage, e.checker,
        e.trigger_min AS triggerMin, c.id AS classId,
        c.name AS className, c.department, s.teacher_id AS teacherId, u.name AS teacherName,
        r.name AS roomName, s.day_of_week AS dayOfWeek, s.start_min AS startMin, s.end_min AS endMin,
        s.alpha_start_min AS alphaStartMin, s.alpha_end_min AS alphaEndMin
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
            r.pre_notified AS preNotified, r.absent_reason AS absentReason, r.late_reason AS lateReason,
            r.eta_min AS etaMin, r.eta_unknown AS etaUnknown, r.absent_from AS absentFrom,
            r.student_call AS studentCall, r.student_call_at AS studentCallAt,
            r.parent_call AS parentCall, r.parent_call_at AS parentCallAt, r.kakao_at AS kakaoAt,
            r.call_result AS callResult, r.arrived_at AS arrivedAt, r.late_arrival AS lateArrival
       FROM attendance_records r
       JOIN students st ON st.id = r.student_id
      WHERE r.event_id = ?
      ORDER BY st.name, st.id`,
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

const activeDeskIds = () =>
  rows<{ id: number }>(getDb().prepare("SELECT id FROM users WHERE role = 'DESK' AND active = 1").all()).map(
    (d) => d.id,
  );

type Opened = { checker: Checker; triggerMin: number; teacherId: number | null; className: string };

function openEvent(sessionId: number, date: string): Opened | null {
  const db = getDb();
  const exists = row<{ id: number }>(
    db.prepare("SELECT id FROM attendance_events WHERE session_id = ? AND date = ?").get(sessionId, date),
  );
  if (exists) return null;

  const s = row<{
    class_id: number;
    teacher_id: number | null;
    class_name: string;
    start_min: number;
    alpha_start_min: number | null;
  }>(
    db
      .prepare(
        `SELECT s.class_id, s.teacher_id, c.name AS class_name, s.start_min, s.alpha_start_min
           FROM timetable_sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      )
      .get(sessionId),
  );
  if (!s) return null;

  const { triggerMin, checker } = triggerOf({ startMin: s.start_min, alphaStartMin: s.alpha_start_min });
  const now = nowIso();
  const r = db
    .prepare(
      `INSERT INTO attendance_events (session_id, date, checker, trigger_min, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'CHECK', ?, ?)`,
    )
    .run(sessionId, date, checker, triggerMin, now, now);
  const eventId = Number(r.lastInsertRowid);

  const students = rows<{ id: number }>(
    db
      .prepare(
        `SELECT s.id FROM student_classes sc JOIN students s ON s.id = sc.student_id
          WHERE sc.class_id = ? AND s.active = 1 ORDER BY s.id`,
      )
      .all(s.class_id),
  );
  const ins = db.prepare(
    "INSERT INTO attendance_records (event_id, student_id, status) VALUES (?, ?, 'UNCHECKED')",
  );
  for (const st of students) ins.run(eventId, st.id);
  return { checker, triggerMin, teacherId: s.teacher_id, className: s.class_name };
}

/**
 * 1차 출석체크 알림 — 알파가 먼저면 데스크 전원, 수업이 먼저면 담당 선생님.
 * 같은 시각에 함께 열린 반들은 팝업처럼 알림도 한 건으로 묶는다 (알림함이 번잡해지지 않게).
 */
function notifyOpened(opened: Opened[]): void {
  const byTarget = new Map<string, { ids: number[]; triggerMin: number; desk: boolean; classes: string[] }>();
  for (const o of opened) {
    const ids = o.checker === "DESK" ? activeDeskIds() : o.teacherId ? [o.teacherId] : [];
    if (ids.length === 0) continue;
    const key = `${o.checker}-${o.triggerMin}-${o.checker === "DESK" ? "desk" : o.teacherId}`;
    const g = byTarget.get(key) ?? { ids, triggerMin: o.triggerMin, desk: o.checker === "DESK", classes: [] };
    g.classes.push(o.className);
    byTarget.set(key, g);
  }
  for (const g of byTarget.values()) {
    const body = `${g.classes.join(", ")} · ${fmtTime(g.triggerMin)} ${g.desk ? "알파" : "수업"} 시작`;
    for (const id of g.ids) notify(id, "ATTENDANCE_CHECK", "출석체크해주세요.", body, "/attendance");
  }
}

/**
 * 폴링 시점 tick — 수업·알파 중 먼저 시작하는 쪽 +2분이 지난 수업의 출결을 연다.
 * 아무도 앱을 켜두지 않으면 그 시간 이벤트가 안 열린다(알려진 한계).
 */
export function tickAttendance(date: string, dayOfWeek: number, nowMin: number): void {
  const due = rows<{ id: number }>(
    getDb()
      .prepare(
        `SELECT s.id FROM timetable_sessions s
          WHERE s.day_of_week = ?
            AND MIN(s.start_min, COALESCE(s.alpha_start_min, s.start_min)) + 2 <= ?
            AND s.end_min > ?
            AND NOT EXISTS (SELECT 1 FROM attendance_events e WHERE e.session_id = s.id AND e.date = ?)`,
      )
      .all(dayOfWeek, nowMin, nowMin - 120, date),
  );
  const opened: Opened[] = [];
  for (const s of due) {
    const o = openEvent(s.id, date);
    if (o) opened.push(o);
  }
  notifyOpened(opened);
}

/** 결석관리의 "지금 열기" — 시작 +2분을 기다리지 않고 즉시 시작. 같은 시각 반들을 한 번에 연다. */
export function triggerAttendance(sessionIds: number[], date: string): void {
  assert(sessionIds.length > 0, "열 수업을 선택해 주세요.");
  // 실제 시간이 되어야 열 수 있다 — 오늘이면 출결 시작 시각(수업·알파 중 이른 쪽)이 지나야 하고, 앞날은 안 된다
  const today = dateKey(new Date());
  assert(date <= today, "아직 오지 않은 날짜의 출결은 열 수 없습니다.");
  if (date === today) {
    const stmt = getDb().prepare("SELECT start_min, alpha_start_min FROM timetable_sessions WHERE id = ?");
    for (const id of sessionIds) {
      const s = row<{ start_min: number; alpha_start_min: number | null }>(stmt.get(id));
      assert(s, "수업을 찾을 수 없습니다.");
      const { triggerMin } = triggerOf({ startMin: s.start_min, alphaStartMin: s.alpha_start_min });
      assert(nowMin() >= triggerMin, `${fmtTime(triggerMin)}부터 열 수 있습니다.`);
    }
  }
  const opened: Opened[] = [];
  for (const id of sessionIds) {
    const o = openEvent(id, date);
    if (o) opened.push(o);
  }
  assert(opened.length > 0, "이미 열려 있는 출결입니다.");
  notifyOpened(opened);
}

/**
 * 내가 지금 처리해야 할 출결 팝업 — 같은 시각에 시작한 반들은 한 장으로 묶는다.
 * - 1차 출석체크: checker 가 TEACHER 면 담당 선생님, DESK 면 데스크 전원
 * - 출결전화: 데스크 전원 (초중고 구분 없음)
 * 관리자는 팝업을 받지 않는다 — 결과는 알림함으로만 받는다.
 */
export function pendingGroupsForUser(user: SessionUser, date: string): AttendanceGroup[] {
  const db = getDb();
  let sql = `${ATT_EVENT_SELECT} WHERE e.date = ?`;
  const args: (string | number)[] = [date];
  if (user.role === "TEACHER") {
    sql += " AND e.stage = 'CHECK' AND e.checker = 'TEACHER' AND s.teacher_id = ?";
    args.push(user.id);
  } else if (user.role === "DESK") {
    sql += " AND (e.stage = 'CALL' OR (e.stage = 'CHECK' AND e.checker = 'DESK'))";
  } else {
    return [];
  }
  sql += " ORDER BY e.trigger_min, c.name";
  const events = attachRecords(rows<EventHead>(db.prepare(sql).all(...args)));

  const groups = new Map<string, AttendanceGroup>();
  for (const e of events) {
    const kind = e.stage === "CALL" ? "CALL" : "CHECK";
    const key = `${kind}-${e.triggerMin}`;
    const g = groups.get(key) ?? { key, kind, triggerMin: e.triggerMin, events: [] };
    g.events.push(e);
    groups.set(key, g);
  }
  // 1차 출석체크를 먼저, 그 다음 출결전화 — 각각 이른 시각부터
  return [...groups.values()].sort(
    (a, b) => (a.kind === b.kind ? a.triggerMin - b.triggerMin : a.kind === "CHECK" ? -1 : 1),
  );
}

export function listAttendanceByIds(ids: number[]): AttendanceEvent[] {
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(",");
  return attachRecords(
    rows<EventHead>(
      getDb()
        .prepare(`${ATT_EVENT_SELECT} WHERE e.id IN (${marks}) ORDER BY e.trigger_min, c.name`)
        .all(...ids),
    ),
  );
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

type EventRow = { id: number; stage: Stage; checker: Checker; teacher_id: number | null; class_name: string };

function eventRow(eventId: number): EventRow {
  const ev = row<EventRow>(
    getDb()
      .prepare(
        `SELECT e.id, e.stage, e.checker, s.teacher_id, c.name AS class_name
           FROM attendance_events e
           JOIN timetable_sessions s ON s.id = e.session_id
           JOIN classes c ON c.id = s.class_id
          WHERE e.id = ?`,
      )
      .get(eventId),
  );
  assert(ev, "출결 정보를 찾을 수 없습니다.");
  return ev;
}

const setStage = (eventId: number, stage: Stage) =>
  getDb().prepare("UPDATE attendance_events SET stage = ?, updated_at = ? WHERE id = ?").run(stage, nowIso(), eventId);

const nowMin = () => minutesOfDay(new Date());

export type CheckInput = {
  eventId: number;
  records: { studentId: number; present: boolean; preNotified: boolean; absentReason?: string | null }[];
};

/**
 * ① 1차 출석체크 제출 — "왔음" 체크 = 출석, "결석 연락 받음" = 바로 결석(사유 필수).
 * 나머지(아직 안 온 학생)는 데스크 출결전화로 넘어간다. 다 왔으면 바로 끝난다.
 */
export function submitCheck(user: SessionUser, items: CheckInput[]): void {
  assert(items.length > 0, "제출할 출석체크가 없습니다.");
  const db = getDb();
  const toCall: string[] = [];
  const finished: number[] = [];

  // 여러 반을 한 번에 제출하므로, 하나라도 문제가 있으면 아무것도 저장하지 않는다 (먼저 전부 검사)
  const evs = new Map<number, EventRow>();
  for (const item of items) {
    const ev = eventRow(item.eventId);
    assert(ev.stage === "CHECK", `${ev.class_name} 출석체크는 이미 제출되었습니다.`);
    if (ev.checker === "TEACHER") {
      assert(
        user.role === "ADMIN" || (user.role === "TEACHER" && ev.teacher_id === user.id),
        "담당 선생님만 출석체크를 제출할 수 있습니다.",
      );
    } else {
      assert(user.role === "ADMIN" || user.role === "DESK", "이 출석체크는 데스크가 제출합니다.");
    }
    for (const r of item.records) {
      assert(
        !r.preNotified || (r.absentReason ?? "").trim(),
        "결석 연락 받은 학생의 결석 사유를 입력해 주세요.",
      );
    }
    evs.set(item.eventId, ev);
  }

  const stmt = db.prepare(
    `UPDATE attendance_records SET status = ?, pre_notified = ?, absent_reason = ?
      WHERE event_id = ? AND student_id = ?`,
  );
  transaction(() => {
    for (const item of items) {
      const ev = evs.get(item.eventId)!;
      let waiting = 0;
      for (const r of item.records) {
        if (r.present) stmt.run("PRESENT", 0, null, item.eventId, r.studentId);
        else if (r.preNotified) stmt.run("ABSENT", 1, (r.absentReason ?? "").trim(), item.eventId, r.studentId);
        else {
          stmt.run("UNCHECKED", 0, null, item.eventId, r.studentId);
          waiting += 1;
        }
      }
      if (waiting > 0) {
        setStage(item.eventId, "CALL");
        toCall.push(`${ev.class_name} ${waiting}명`);
      } else {
        setStage(item.eventId, "DONE");
        finished.push(item.eventId);
      }
    }
  });

  if (toCall.length > 0) {
    for (const id of activeDeskIds()) {
      notify(id, "ATTENDANCE_CALL", "출결전화 돌려주세요.", toCall.join(" · "), "/attendance");
    }
  }
  sendAttendanceResults(finished);
}

/**
 * ② 출결전화 — 버튼을 누를 때마다 학생 한 명의 진행 상태를 저장한다.
 * 같은 버튼을 다시 누르면 취소(클라이언트가 null 로 보낸다). 순서가 꼬이지 않게 normalizeCall 로 정리한다.
 */
export function updateCall(user: SessionUser, recordId: number, input: CallState): AttendanceRecord {
  assert(user.role === "ADMIN" || user.role === "DESK", "데스크만 출결전화를 기록할 수 있습니다.");
  const db = getDb();
  const cur = row<{ event_id: number; status: AttStatus; stage: Stage } & Record<string, unknown>>(
    db
      .prepare(
        `SELECT r.*, e.stage FROM attendance_records r JOIN attendance_events e ON e.id = r.event_id WHERE r.id = ?`,
      )
      .get(recordId),
  );
  assert(cur, "학생 출결 정보를 찾을 수 없습니다.");
  assert(cur.stage === "CALL" && cur.status === "UNCHECKED", "이미 저장된 출결전화입니다.");

  const next = normalizeCall(input);
  const t = nowMin();
  // 값이 새로 생긴 칸만 지금 시각을 찍고, 그대로면 원래 시각을 유지, 지워지면 비운다
  const stamp = (prev: unknown, prevAt: unknown, value: unknown) =>
    value === null || value === false ? null : prev === value ? (prevAt as number | null) ?? t : t;

  db.prepare(
    `UPDATE attendance_records
        SET student_call = ?, student_call_at = ?, parent_call = ?, parent_call_at = ?,
            kakao_at = ?, arrived_at = ?, call_result = ?, late_reason = ?, absent_reason = ?, eta_min = ?,
            eta_unknown = ?
      WHERE id = ?`,
  ).run(
    next.studentCall,
    stamp(cur.student_call, cur.student_call_at, next.studentCall),
    next.parentCall,
    stamp(cur.parent_call, cur.parent_call_at, next.parentCall),
    next.kakao ? ((cur.kakao_at as number | null) ?? t) : null,
    next.arrived ? ((cur.arrived_at as number | null) ?? t) : null,
    next.callResult,
    next.callResult === "LATE" ? next.reason.trim() || null : null,
    next.callResult === "ABSENT" ? next.reason.trim() || null : null,
    next.etaMin,
    next.etaUnknown ? 1 : 0,
    recordId,
  );
  return attachRecords([{ id: cur.event_id } as EventHead])[0].records.find((r) => r.id === recordId)!;
}

/** ② 출결전화 저장 — 남은 인원이 0명이고 통화된 학생의 정보가 다 채워져야 저장된다 */
export function completeCall(user: SessionUser, eventIds: number[]): void {
  assert(user.role === "ADMIN" || user.role === "DESK", "데스크만 출결전화를 저장할 수 있습니다.");
  const events = listAttendanceByIds(eventIds);
  assert(events.length > 0, "저장할 출결전화가 없습니다.");

  let remaining = 0;
  let missingInfo = 0;
  for (const e of events) {
    assert(e.stage === "CALL", `${e.className} 출결전화는 이미 저장되었습니다.`);
    for (const r of e.records.filter((r) => r.status === "UNCHECKED")) {
      const c = callStateOf(r);
      if (isRemaining(c)) remaining += 1;
      else if (needsInfo(c)) missingInfo += 1;
    }
  }
  assert(remaining === 0, `아직 연락이 닿지 않은 학생이 ${remaining}명 있습니다.`);
  assert(missingInfo === 0, `지각·결석 사유(도착예정시간)를 입력하지 않은 학생이 ${missingInfo}명 있습니다.`);

  const stmt = getDb().prepare("UPDATE attendance_records SET status = ? WHERE id = ?");
  transaction(() => {
    for (const e of events) {
      for (const r of e.records.filter((r) => r.status === "UNCHECKED")) {
        stmt.run(finalStatus(callStateOf(r)), r.id);
      }
      setStage(e.id, "DONE");
    }
  });
  sendAttendanceResults(events.map((e) => e.id));
}

function recordById(recordId: number): AttendanceRecord & { eventId: number } {
  const r = row<{ event_id: number }>(
    getDb().prepare("SELECT event_id FROM attendance_records WHERE id = ?").get(recordId),
  );
  assert(r, "학생 출결 정보를 찾을 수 없습니다.");
  const rec = attachRecords([{ id: r.event_id } as EventHead])[0].records.find((x) => x.id === recordId);
  assert(rec, "학생 출결 정보를 찾을 수 없습니다.");
  return { ...rec, eventId: r.event_id };
}

/**
 * ④ 나중 도착 — 데스크가 결석관리에서 [도착] 을 누른다. 선생님께 따로 알림은 보내지 않는다.
 * - 연락 안 됨 → 지각 명단으로 옮기고 도착 시각 기록
 * - 도착시간 모름 지각 → 실제 도착 시각만 기록
 * 다시 누르면(도착 취소) 원래대로 되돌린다.
 */
export function toggleLateArrival(user: SessionUser, recordId: number): void {
  assert(user.role === "ADMIN" || user.role === "DESK", "데스크만 도착 처리를 할 수 있습니다.");
  const db = getDb();
  const r = recordById(recordId);
  if (r.lateArrival) {
    db.prepare("UPDATE attendance_records SET status = 'NO_CONTACT', late_arrival = 0, arrived_at = NULL WHERE id = ?").run(
      recordId,
    );
  } else if (r.status === "NO_CONTACT") {
    db.prepare("UPDATE attendance_records SET status = 'LATE', late_arrival = 1, arrived_at = ? WHERE id = ?").run(
      nowMin(),
      recordId,
    );
  } else if (r.status === "LATE" && r.etaUnknown) {
    db.prepare("UPDATE attendance_records SET arrived_at = ? WHERE id = ?").run(
      r.arrivedAt === null ? nowMin() : null,
      recordId,
    );
  } else {
    assert(false, "연락 안 됨 학생이나 도착시간을 모르는 지각 학생만 도착 처리할 수 있습니다.");
  }
}

/**
 * [결석으로 변경] — 연락 안 됨, 또는 도착시간을 모르는 지각 학생이 끝내 오지 않았을 때 (사유 필수).
 * 결석이 되면 보강 관리의 "보강이 필요한 결석" 에 자동으로 올라간다. 알림은 보내지 않는다.
 */
export function markAbsent(user: SessionUser, recordId: number, reason: string): void {
  assert(user.role === "ADMIN" || user.role === "DESK", "데스크만 결석으로 변경할 수 있습니다.");
  assert(reason.trim(), "결석 사유를 입력해 주세요.");
  const r = recordById(recordId);
  assert(canMarkAbsent(r), "연락 안 됨 학생이나 도착시간을 모르는 지각 학생만 결석으로 변경할 수 있습니다.");
  getDb()
    .prepare("UPDATE attendance_records SET status = 'ABSENT', absent_from = ?, absent_reason = ? WHERE id = ?")
    .run(r.status, reason.trim(), recordId);
}

/** [결석으로 변경] 되돌리기 — 이미 보강을 잡았으면 되돌릴 수 없다 */
export function undoMarkAbsent(user: SessionUser, recordId: number): void {
  assert(user.role === "ADMIN" || user.role === "DESK", "데스크만 되돌릴 수 있습니다.");
  const db = getDb();
  const r = recordById(recordId);
  assert(r.status === "ABSENT" && r.absentFrom, "결석으로 변경한 기록이 아닙니다.");
  const ev = row<{ date: string }>(db.prepare("SELECT date FROM attendance_events WHERE id = ?").get(r.eventId));
  const makeup = row<{ n: number }>(
    db
      .prepare("SELECT COUNT(*) AS n FROM makeups WHERE student_id = ? AND absent_date = ? AND status <> 'CANCELED'")
      .get(r.studentId, ev?.date ?? ""),
  );
  assert((makeup?.n ?? 0) === 0, "이미 보강이 잡혀 있어 되돌릴 수 없습니다. 보강 관리에서 먼저 취소해 주세요.");
  // 지각이었다면 사유는 late_reason 에 그대로 남아 있다
  db.prepare("UPDATE attendance_records SET status = ?, absent_from = NULL, absent_reason = NULL WHERE id = ?").run(
    r.absentFrom,
    recordId,
  );
}

/**
 * ③ 출결 결과 — 팝업 없이 알림함에만 넣는다.
 * 담당 선생님은 본인 반만, 관리자는 이번에 끝난 모든 반을 한 번에 받는다. 지각·결석·연락 안 됨이 없으면 보내지 않는다.
 */
function sendAttendanceResults(eventIds: number[]): void {
  const events = listAttendanceByIds(eventIds);
  const withIssues = events.filter((e) => e.records.some((r) => ISSUE.has(r.status)));
  if (withIssues.length === 0) return;

  const date = withIssues[0].date;
  for (const e of withIssues) {
    if (!e.teacherId) continue;
    notify(
      e.teacherId,
      "ATTENDANCE_RESULT",
      "출결사항 확인해주세요.",
      `${e.className} · ${issueSummary([e])}`,
      `/attendance?date=${date}&events=${e.id}`,
    );
  }
  const admins = rows<{ id: number }>(getDb().prepare("SELECT id FROM users WHERE role = 'ADMIN' AND active = 1").all());
  const ids = withIssues.map((e) => e.id).join(",");
  const title = `${fmtTime(Math.min(...withIssues.map((e) => e.triggerMin)))} 출결 · ${withIssues.map((e) => e.className).join(", ")}`;
  for (const a of admins) {
    notify(a.id, "ATTENDANCE_RESULT", "출결사항 확인해주세요.", `${title} · ${issueSummary(withIssues)}`, `/attendance?date=${date}&events=${ids}`);
  }
}

const ISSUE = new Set<AttStatus>(["LATE", "ABSENT", "NO_CONTACT"]);

function issueSummary(events: AttendanceEvent[]): string {
  const all = events.flatMap((e) => e.records);
  const n = (s: AttStatus) => all.filter((r) => r.status === s).length;
  return (
    [
      ["지각", n("LATE")],
      ["결석", n("ABSENT")],
      ["연락 안 됨", n("NO_CONTACT")],
    ] as const
  )
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

export function attendanceSummary(date: string, dept: DeptFilter = "ALL") {
  const events = listAttendance(date, dept);
  const byStage: Record<Stage, number> = { CHECK: 0, CALL: 0, DONE: 0 };
  const count: Record<AttStatus, number> = { UNCHECKED: 0, PRESENT: 0, ABSENT: 0, LATE: 0, NO_CONTACT: 0 };
  for (const e of events) {
    byStage[e.stage] += 1;
    for (const r of e.records) count[r.status] += 1;
  }
  return {
    total: events.length,
    byStage,
    present: count.PRESENT,
    absent: count.ABSENT,
    late: count.LATE,
    noContact: count.NO_CONTACT,
    unchecked: count.UNCHECKED,
  };
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
export function todaySchedule(user: SessionUser, dayOfWeek: number, date?: string): ScheduleItem[] {
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

  // 보강도 담당 선생님 일정에 함께 뜬다
  if (date) {
    for (const m of listMakeups({ fromDate: date, toDate: date, status: "PLANNED" })) {
      if (user.role === "TEACHER" && m.teacherId !== user.id) continue;
      items.push({
        startMin: m.startMin,
        endMin: m.endMin,
        title: `${m.studentName} 보강`,
        subtitle: [m.className, m.roomName, m.teacherName ? `${m.teacherName} 선생님` : null]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }

  return items.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

/* -------------------------------------------------------------------- 보강 */

const MAKEUP_SELECT = `SELECT m.id, m.student_id AS studentId, st.name AS studentName,
        m.class_id AS classId, c.name AS className, st.department,
        m.absent_date AS absentDate, m.date, m.start_min AS startMin, m.end_min AS endMin,
        m.room_id AS roomId, r.name AS roomName, m.teacher_id AS teacherId, u.name AS teacherName,
        m.note, m.status, m.created_at AS createdAt
   FROM makeups m
   JOIN students st ON st.id = m.student_id
   LEFT JOIN classes c ON c.id = m.class_id
   LEFT JOIN rooms r ON r.id = m.room_id
   LEFT JOIN users u ON u.id = m.teacher_id`;

export function listMakeups(opts: {
  dept?: DeptFilter;
  fromDate?: string | null;
  toDate?: string | null;
  status?: MakeupStatus | "ALL";
  teacherId?: number | null;
} = {}): Makeup[] {
  const args: (string | number)[] = [];
  let sql = `${MAKEUP_SELECT} WHERE 1 = 1`;
  if (opts.dept && opts.dept !== "ALL") {
    sql += " AND st.department = ?";
    args.push(opts.dept);
  }
  if (opts.fromDate) {
    sql += " AND m.date >= ?";
    args.push(opts.fromDate);
  }
  if (opts.toDate) {
    sql += " AND m.date <= ?";
    args.push(opts.toDate);
  }
  if (opts.status && opts.status !== "ALL") {
    sql += " AND m.status = ?";
    args.push(opts.status);
  }
  if (opts.teacherId) {
    sql += " AND m.teacher_id = ?";
    args.push(opts.teacherId);
  }
  sql += " ORDER BY m.date, m.start_min, m.id";
  return rows<Makeup>(getDb().prepare(sql).all(...args));
}

/**
 * 보강이 필요한 결석 목록.
 * 횟수로 수강료를 받기 때문에 결석 1건마다 보강이 이루어졌는지 추적한다.
 */
export function pendingAbsences(dept: DeptFilter = "ALL", onlyUnfinished = false): PendingAbsence[] {
  const w = deptWhere("c.department", dept);
  let sql = `SELECT e.date, r.student_id AS studentId, st.name AS studentName,
                    c.id AS classId, c.name AS className, c.department,
                    s.teacher_id AS teacherId, u.name AS teacherName,
                    r.absent_reason AS reason,
                    m.id AS makeupId, m.status AS makeupStatus, m.date AS makeupDate
               FROM attendance_records r
               JOIN attendance_events e ON e.id = r.event_id
               JOIN timetable_sessions s ON s.id = e.session_id
               JOIN classes c ON c.id = s.class_id
               JOIN students st ON st.id = r.student_id
               LEFT JOIN users u ON u.id = s.teacher_id
               LEFT JOIN makeups m ON m.student_id = r.student_id
                                  AND m.absent_date = e.date
                                  AND m.status <> 'CANCELED'
              WHERE r.status = 'ABSENT'${w.sql}`;
  if (onlyUnfinished) sql += " AND (m.id IS NULL OR m.status <> 'DONE')";
  sql += " ORDER BY e.date DESC, c.name, st.id";
  return rows<PendingAbsence>(getDb().prepare(sql).all(...w.args));
}

export type MakeupInput = {
  studentId: number;
  classId?: number | null;
  absentDate?: string | null;
  date: string;
  startMin: number;
  endMin: number;
  roomId?: number | null;
  teacherId?: number | null;
  note?: string | null;
};

function validateMakeup(input: MakeupInput): void {
  assert(input.studentId, "보강 대상 학생을 선택해 주세요.");
  assert(input.date, "보강 날짜를 선택해 주세요.");
  assert(
    Number.isSafeInteger(input.startMin) && Number.isSafeInteger(input.endMin),
    "보강 시간을 선택해 주세요.",
  );
  assert(input.endMin > input.startMin, "보강 종료시간은 시작시간보다 뒤여야 합니다.");
}

export function createMakeup(input: MakeupInput): number {
  validateMakeup(input);
  const db = getDb();

  if (input.absentDate) {
    const dup = row<{ n: number }>(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM makeups WHERE student_id = ? AND absent_date = ? AND status <> 'CANCELED'",
        )
        .get(input.studentId, input.absentDate),
    );
    assert((dup?.n ?? 0) === 0, "이 결석에는 이미 보강이 잡혀 있습니다.");
  }

  const r = db
    .prepare(
      `INSERT INTO makeups
        (student_id, class_id, absent_date, date, start_min, end_min, room_id, teacher_id, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?)`,
    )
    .run(
      input.studentId,
      input.classId ?? null,
      input.absentDate || null,
      input.date,
      input.startMin,
      input.endMin,
      input.roomId ?? null,
      input.teacherId ?? null,
      input.note?.trim() || null,
      nowIso(),
    );

  if (input.teacherId) {
    const st = row<{ name: string }>(
      db.prepare("SELECT name FROM students WHERE id = ?").get(input.studentId),
    );
    notify(
      input.teacherId,
      "MAKEUP",
      "보강이 등록되었습니다.",
      `${st?.name ?? "학생"} · ${input.date} ${rangeLabel(input.startMin, input.endMin)}`,
      "/makeup",
    );
  }
  return Number(r.lastInsertRowid);
}

export function updateMakeup(
  id: number,
  input: Partial<MakeupInput> & { status?: MakeupStatus },
): void {
  const db = getDb();
  const cur = row<{ id: number }>(db.prepare("SELECT id FROM makeups WHERE id = ?").get(id));
  assert(cur, "보강을 찾을 수 없습니다.");

  if (input.date !== undefined) db.prepare("UPDATE makeups SET date = ? WHERE id = ?").run(input.date, id);
  if (input.startMin !== undefined && input.endMin !== undefined) {
    assert(input.endMin > input.startMin, "보강 종료시간은 시작시간보다 뒤여야 합니다.");
    db.prepare("UPDATE makeups SET start_min = ?, end_min = ? WHERE id = ?").run(
      input.startMin,
      input.endMin,
      id,
    );
  }
  if (input.roomId !== undefined)
    db.prepare("UPDATE makeups SET room_id = ? WHERE id = ?").run(input.roomId ?? null, id);
  if (input.teacherId !== undefined)
    db.prepare("UPDATE makeups SET teacher_id = ? WHERE id = ?").run(input.teacherId ?? null, id);
  if (input.note !== undefined)
    db.prepare("UPDATE makeups SET note = ? WHERE id = ?").run(input.note?.trim() || null, id);
  if (input.status !== undefined)
    db.prepare("UPDATE makeups SET status = ? WHERE id = ?").run(input.status, id);
}

export function deleteMakeup(id: number): void {
  getDb().prepare("DELETE FROM makeups WHERE id = ?").run(id);
}

/** 보강 현황 요약 — 횟수 관리를 위해 한눈에 본다 */
export function makeupSummary(dept: DeptFilter = "ALL") {
  const all = pendingAbsences(dept);
  let notScheduled = 0;
  let planned = 0;
  let done = 0;
  for (const a of all) {
    if (!a.makeupId) notScheduled += 1;
    else if (a.makeupStatus === "DONE") done += 1;
    else planned += 1;
  }
  return { absences: all.length, notScheduled, planned, done };
}
