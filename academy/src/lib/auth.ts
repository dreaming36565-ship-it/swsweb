// ★ 서버 전용. 클라이언트 컴포넌트에서 import 금지.
// 사내망 전제의 단순 구현 — 비밀번호 평문 저장, 쿠키는 HMAC 서명만 한다.

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
import { ROLES, type Department, type Role, type SessionUser } from "./types";

const SECRET = process.env.ACADEMY_SECRET ?? "academy-local-dev-secret";
export const COOKIE_NAME = "academy_session";

type UserRow = {
  id: number;
  login_id: string;
  name: string;
  role: Role;
  roles: string;
  department: Department;
  active: number;
  must_change_pw: number;
};

const USER_COLS = "id, login_id, name, role, roles, department, active, must_change_pw";

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

/** "ADMIN,TEACHER" → ["ADMIN","TEACHER"] (없으면 대표 권한 하나) */
export function parseRoles(roles: string | null | undefined, fallback?: string): Role[] {
  const list = (roles ?? "").split(",").filter((r): r is Role => (ROLES as string[]).includes(r));
  if (list.length) return ROLES.filter((r) => list.includes(r));
  return fallback && (ROLES as string[]).includes(fallback) ? [fallback as Role] : [];
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    loginId: row.login_id,
    name: row.name,
    roles: parseRoles(row.roles, row.role),
    department: row.department,
    mustChangePw: row.must_change_pw === 1,
  };
}

export function findUserById(id: number): SessionUser | null {
  const row = getDb().prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as unknown as UserRow | undefined;
  if (!row || row.active !== 1) return null;
  return toSessionUser(row);
}

/** 한글 이름(또는 예전 영문 아이디)으로 로그인. 이름이 같은 직원이 둘 이상이면 이름으로는 로그인할 수 없다. */
export function verifyLogin(loginId: string, password: string): SessionUser | null {
  const select = `SELECT ${USER_COLS}, password FROM users`;
  const db = getDb();
  let row = db.prepare(`${select} WHERE login_id = ?`).get(loginId) as unknown as
    | (UserRow & { password: string })
    | undefined;
  if (!row) {
    const byName = db.prepare(`${select} WHERE name = ? AND active = 1`).all(loginId) as unknown as (UserRow & {
      password: string;
    })[];
    if (byName.length === 1) row = byName[0];
  }
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

export { PERMISSIONS, can, type Permission } from "./perm";
