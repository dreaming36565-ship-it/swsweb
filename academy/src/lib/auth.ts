// ★ 서버 전용. 클라이언트 컴포넌트에서 import 금지.
// 사내망 전제의 단순 구현 — 비밀번호 평문 저장, 쿠키는 HMAC 서명만 한다.

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
import type { Department, Role, SessionUser } from "./types";

const SECRET = process.env.ACADEMY_SECRET ?? "academy-local-dev-secret";
export const COOKIE_NAME = "academy_session";

type UserRow = {
  id: number;
  login_id: string;
  name: string;
  role: Role;
  department: Department;
  active: number;
};

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function makeToken(userId: number): string {
  const payload = String(userId);
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): number | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const id = Number.parseInt(payload, 10);
  return Number.isSafeInteger(id) ? id : null;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    loginId: row.login_id,
    name: row.name,
    role: row.role,
    department: row.department,
  };
}

export function findUserById(id: number): SessionUser | null {
  const row = getDb()
    .prepare("SELECT id, login_id, name, role, department, active FROM users WHERE id = ?")
    .get(id) as unknown as UserRow | undefined;
  if (!row || row.active !== 1) return null;
  return toSessionUser(row);
}

export function verifyLogin(loginId: string, password: string): SessionUser | null {
  const row = getDb()
    .prepare(
      "SELECT id, login_id, name, role, department, active, password FROM users WHERE login_id = ?",
    )
    .get(loginId) as unknown as (UserRow & { password: string }) | undefined;
  if (!row || row.active !== 1) return null;
  if (row.password !== password) return null;
  return toSessionUser(row);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const id = readToken(token);
  if (id === null) return null;
  return findUserById(id);
}

/** 기능별 허용 역할 — 새 기능을 추가할 때 여기에 함께 등록할 것 */
export const PERMISSIONS = {
  "timetable.read": ["ADMIN", "TEACHER", "DESK"],
  "timetable.write": ["ADMIN"],
  "sr.read": ["ADMIN", "TEACHER", "DESK"],
  "sr.move": ["ADMIN", "TEACHER", "DESK"],
  "attendance.teacher": ["ADMIN", "TEACHER"],
  "attendance.desk": ["ADMIN", "DESK"],
  "attendance.read": ["ADMIN", "TEACHER", "DESK"],
  "makeups.read": ["ADMIN", "TEACHER", "DESK"],
  "makeups.write": ["ADMIN", "TEACHER", "DESK"],
  "makeups.delete": ["ADMIN"],
  "classes.write": ["ADMIN"],
  "rooms.write": ["ADMIN"],
  "users.write": ["ADMIN"],
  "students.write": ["ADMIN", "DESK"],
  "notices.write": ["ADMIN"],
  "tasks.write": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(user: Pick<SessionUser, "role">, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly Role[]).includes(user.role);
}
