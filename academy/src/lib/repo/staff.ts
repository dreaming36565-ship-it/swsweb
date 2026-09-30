// ★ 서버 전용. 강의실 · 계정(권한 여러 개) · 교재 책장.

import { getDb } from "../db";
import { assert } from "../errors";
import { checkPassword, hashPassword, parseDays, parseRoles } from "../auth";
import { bookFull, parseBook } from "../books";
import { ROLES, type Book, type Role, type Room, type StaffUser } from "../types";
import { nowIso, row, rows } from "./base";

/* ------------------------------------------------------------------ 강의실 */

export function listRooms(): Room[] {
  return rows<Room>(
    getDb()
      .prepare("SELECT id, name, order_no AS orderNo, is_sr AS isSr, capacity FROM rooms ORDER BY order_no, id")
      .all(),
  );
}

export function createRoom(name: string): number {
  const trimmed = name.trim();
  assert(trimmed, "강의실 이름을 입력해 주세요.");
  const db = getDb();
  assert(!row(db.prepare("SELECT id FROM rooms WHERE name = ?").get(trimmed)), "같은 이름의 강의실이 이미 있습니다.");
  const max = row<{ n: number | null }>(db.prepare("SELECT MAX(order_no) AS n FROM rooms").get());
  const r = db.prepare("INSERT INTO rooms (name, order_no, is_sr) VALUES (?, ?, 0)").run(trimmed, (max?.n ?? 0) + 1);
  return Number(r.lastInsertRowid);
}

export function updateRoom(id: number, input: { name?: string; capacity?: number | null }): void {
  const db = getDb();
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    assert(trimmed, "강의실 이름을 입력해 주세요.");
    db.prepare("UPDATE rooms SET name = ? WHERE id = ?").run(trimmed, id);
  }
  if (input.capacity !== undefined) {
    const cap = input.capacity === null ? null : Math.floor(Number(input.capacity));
    assert(cap === null || (Number.isFinite(cap) && cap > 0), "최대 인원은 1 이상의 숫자로 넣어 주세요.");
    db.prepare("UPDATE rooms SET capacity = ? WHERE id = ?").run(cap, id);
  }
}

export function deleteRoom(id: number): void {
  const db = getDb();
  const target = row<Room>(db.prepare("SELECT id, name, is_sr AS isSr FROM rooms WHERE id = ?").get(id));
  assert(target, "강의실을 찾을 수 없습니다.");
  assert(target.isSr !== 1, "SR룸은 삭제할 수 없습니다.");
  const used = row<{ n: number }>(
    db.prepare("SELECT COUNT(*) AS n FROM timetable_sessions WHERE room_id = ? OR alpha_room_id = ?").get(id, id),
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
  const stmt = db.prepare("UPDATE rooms SET order_no = ? WHERE id = ?");
  stmt.run(all[swapWith].orderNo, all[idx].id);
  stmt.run(all[idx].orderNo, all[swapWith].id);
}

/* -------------------------------------------------------------------- 계정 */

type UserDbRow = {
  id: number;
  loginId: string;
  name: string;
  role: string;
  roles: string;
  department: string;
  active: number;
  employment: string;
  workDays: string;
  seenAt: string | null;
  notifyState: string | null;
};

/** 30초 안에 4초 폴링이 왔으면 「켜져 있음」 */
const ONLINE_MS = 30_000;

const toStaff = (u: UserDbRow): StaffUser => ({
  id: u.id,
  loginId: u.loginId,
  name: u.name,
  roles: parseRoles(u.roles, u.role),
  department: u.department as StaffUser["department"],
  active: u.active === 1 ? 1 : 0,
  partTime: u.employment === "PART",
  workDays: parseDays(u.workDays),
  online: !!u.seenAt && Date.now() - Date.parse(u.seenAt) < ONLINE_MS,
  seenAt: u.seenAt,
  notifyState: (["granted", "default", "denied", "none"].includes(u.notifyState ?? "") ? u.notifyState : null) as StaffUser["notifyState"],
});

/** 4초 폴링 — 앱을 켜 두었음 + 그 컴퓨터 윈도우 알림 상태 */
export function touchUser(userId: number, notifyState: string | null): void {
  const state = ["granted", "default", "denied", "none"].includes(notifyState ?? "") ? notifyState : null;
  getDb().prepare("UPDATE users SET seen_at = ?, notify_state = COALESCE(?, notify_state) WHERE id = ?").run(new Date().toISOString(), state, userId);
}

export function listUsers(): StaffUser[] {
  return rows<UserDbRow>(
    getDb()
      .prepare(
        "SELECT id, login_id AS loginId, name, role, roles, department, active, employment, work_days AS workDays, seen_at AS seenAt, notify_state AS notifyState FROM users ORDER BY id",
      )
      .all(),
  ).map(toStaff);
}

/** 선생님 권한이 있는 활성 직원 — 시간표의 담당 선생님 후보 */
export function listTeachers(): StaffUser[] {
  return listUsers().filter((u) => u.active === 1 && u.roles.includes("TEACHER"));
}

const cleanRoles = (roles: string[]): Role[] => ROLES.filter((r) => roles.includes(r));

function assertAdminRemains(exceptId: number): void {
  const others = listUsers().filter((u) => u.id !== exceptId && u.active === 1 && u.roles.includes("ADMIN"));
  assert(others.length > 0, "관리자가 한 명은 있어야 해요.");
}

/** 새 계정 — 아이디 = 한글 이름, 처음 비밀번호 1234 (처음 로그인하면 새 비밀번호를 정한다) */
export function createUser(input: { name: string; roles: string[]; department: string }): number {
  const name = input.name.trim();
  assert(name, "이름을 입력해 주세요.");
  const roles = cleanRoles(input.roles);
  assert(roles.length > 0, "권한을 하나 이상 골라야 해요.");
  const db = getDb();
  assert(
    !row(db.prepare("SELECT id FROM users WHERE login_id = ? OR name = ?").get(name, name)),
    "같은 이름의 직원이 이미 있어요. 이름 뒤에 구분 글자를 붙여 주세요 (예: 김민지B).",
  );
  const r = db
    .prepare(
      "INSERT INTO users (login_id, password, name, role, roles, department, active, must_change_pw) VALUES (?, '1234', ?, ?, ?, ?, 1, 1)",
    )
    .run(name, name, roles[0], roles.join(","), input.department === "HIGH" ? "HIGH" : "ELEM");
  return Number(r.lastInsertRowid);
}

export function updateUser(
  id: number,
  input: { name?: string; roles?: string[]; department?: string; active?: number; partTime?: boolean; workDays?: number[] },
): void {
  const db = getDb();
  const cur = listUsers().find((u) => u.id === id);
  assert(cur, "계정을 찾을 수 없습니다.");
  if (input.name !== undefined) {
    const name = input.name.trim();
    assert(name, "이름을 입력해 주세요.");
    assert(
      !row(db.prepare("SELECT id FROM users WHERE (login_id = ? OR name = ?) AND id <> ?").get(name, name, id)),
      "같은 이름의 직원이 이미 있어요.",
    );
    // 아이디 = 한글 이름
    db.prepare("UPDATE users SET name = ?, login_id = ? WHERE id = ?").run(name, name, id);
  }
  if (input.roles !== undefined) {
    const roles = cleanRoles(input.roles);
    assert(roles.length > 0, "권한을 하나 이상 골라야 해요.");
    if (cur.roles.includes("ADMIN") && !roles.includes("ADMIN")) assertAdminRemains(id);
    db.prepare("UPDATE users SET role = ?, roles = ? WHERE id = ?").run(roles[0], roles.join(","), id);
  }
  if (input.department !== undefined)
    db.prepare("UPDATE users SET department = ? WHERE id = ?").run(input.department === "HIGH" ? "HIGH" : "ELEM", id);
  // 근무 — 정직원 / 알바 + 근무 요일 (알바는 근무 요일의 시간표 · SR만 본다)
  if (input.partTime !== undefined) db.prepare("UPDATE users SET employment = ? WHERE id = ?").run(input.partTime ? "PART" : "FULL", id);
  if (input.workDays !== undefined) {
    const days = parseDays(input.workDays.join(",")).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    db.prepare("UPDATE users SET work_days = ? WHERE id = ?").run(days.join(","), id);
  }
  if (input.active !== undefined) {
    if (!input.active && cur.roles.includes("ADMIN")) assertAdminRemains(id);
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(input.active ? 1 : 0, id);
  }
}

/** 비밀번호 초기화 — 1234, 다음 로그인 때 새 비밀번호를 정한다 */
export function resetPassword(id: number): void {
  const r = getDb().prepare("UPDATE users SET password = '1234', must_change_pw = 1 WHERE id = ?").run(id);
  assert(Number(r.changes) > 0, "계정을 찾을 수 없습니다.");
}

/** 관리자가 비밀번호를 정해 준다 — 그 비밀번호로 바로 쓴다(바꾸라고 하지 않음). 본인은 설정에서 언제든 바꿀 수 있다 */
export function setPasswordByAdmin(id: number, pw: string): void {
  assert(pw.length >= 4, "비밀번호는 4자 이상이어야 해요.");
  assert(pw !== "1234", "1234는 처음 비밀번호라 쓸 수 없어요. 다른 비밀번호로 정해 주세요.");
  const r = getDb().prepare("UPDATE users SET password = ?, must_change_pw = 0 WHERE id = ?").run(hashPassword(pw), id);
  assert(Number(r.changes) > 0, "계정을 찾을 수 없습니다.");
}

/** 내 비밀번호 바꾸기 */
export function changePassword(userId: number, next: string, current?: string | null): void {
  const db = getDb();
  const u = row<{ password: string; must_change_pw: number }>(
    db.prepare("SELECT password, must_change_pw FROM users WHERE id = ?").get(userId),
  );
  assert(u, "계정을 찾을 수 없습니다.");
  // 처음 비밀번호를 바꾸는 중이 아니면 지금 비밀번호를 확인한다
  if (u.must_change_pw !== 1) assert(current && checkPassword(u.password, current), "지금 비밀번호가 맞지 않아요.");
  assert(next.length >= 4, "새 비밀번호는 4자 이상이어야 해요.");
  assert(next !== "1234", "처음 비밀번호(1234)와 다른 비밀번호로 정해 주세요.");
  db.prepare("UPDATE users SET password = ?, must_change_pw = 0 WHERE id = ?").run(hashPassword(next), userId);
}

export function deleteUser(id: number, actingUserId: number): void {
  assert(id !== actingUserId, "본인 계정은 삭제할 수 없습니다.");
  const db = getDb();
  const target = listUsers().find((u) => u.id === id);
  assert(target, "계정을 찾을 수 없습니다.");
  if (target.roles.includes("ADMIN")) assertAdminRemains(id);
  const used = row<{ n: number }>(
    db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM timetable_sessions WHERE teacher_id = ?) + (SELECT COUNT(*) FROM classes WHERE teacher_id = ?) AS n",
      )
      .get(id, id),
  );
  assert((used?.n ?? 0) === 0, `${target.name}T 은(는) 시간표에서 담당 중이라 지울 수 없어요. 먼저 반의 담당을 바꿔 주세요.`);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

/* ---------------------------------------------------------------- 교재 책장 */

export function listBooks(): Book[] {
  return rows<Book>(
    getDb().prepare("SELECT id, level, grade, name, created_at AS createdAt FROM books ORDER BY id").all(),
  );
}

function validBook(input: { level: string; grade: string; name: string }) {
  const rec = { level: input.level.trim(), grade: input.grade.trim(), name: input.name.trim() };
  assert(["초등", "중등", "고등"].includes(rec.level), "학교급(초등·중등·고등)을 골라 주세요.");
  assert(rec.grade, "과정(학년-학기)을 골라 주세요.");
  assert(rec.name, "교재 이름을 입력해 주세요.");
  return rec;
}

export function createBook(input: { level: string; grade: string; name: string }): number {
  const rec = validBook(input);
  const dup = listBooks().find((b) => bookFull(b) === bookFull(rec));
  assert(!dup, "이미 있는 교재예요.");
  return Number(
    getDb()
      .prepare("INSERT INTO books (level, grade, name, created_at) VALUES (?, ?, ?, ?)")
      .run(rec.level, rec.grade, rec.name, nowIso()).lastInsertRowid,
  );
}

export function updateBook(id: number, input: { level: string; grade: string; name: string }): void {
  const rec = validBook(input);
  const dup = listBooks().find((b) => b.id !== id && bookFull(b) === bookFull(rec));
  assert(!dup, "이미 있는 교재예요.");
  getDb().prepare("UPDATE books SET level = ?, grade = ?, name = ? WHERE id = ?").run(rec.level, rec.grade, rec.name, id);
}

export function deleteBook(id: number): void {
  getDb().prepare("DELETE FROM books WHERE id = ?").run(id);
}

/** 「초등 5-1 심화」 한 줄 → 책장의 교재 (없으면 새로 넣는다) */
export function findOrCreateBook(text: string): number {
  const parsed = parseBook(text);
  assert(parsed && parsed.name, "과정 + 교재 이름으로 입력해 주세요. 예) 초등 5-1 심화");
  const found = listBooks().find((b) => bookFull(b) === bookFull(parsed));
  return found ? found.id : createBook(parsed);
}
