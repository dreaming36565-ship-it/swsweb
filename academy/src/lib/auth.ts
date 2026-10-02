// ★ 서버 전용. 클라이언트 컴포넌트에서 import 금지.
// 비밀번호는 scrypt 해시로 저장한다(예전 평문은 로그인할 때 저절로 해시로 바뀐다). 쿠키는 HMAC 서명.

import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
import { ROLES, type Department, type Role, type SessionUser } from "./types";

export const COOKIE_NAME = "academy_session";

/**
 * 쿠키 서명 비밀값 — 환경변수가 없으면 DB에 한 번 만들어 둔 무작위 값 (서버를 다시 켜도 로그인 유지).
 * ★ globalThis 에 둔다: Next.js 는 화면과 API 가 이 파일을 따로 불러와서, 모듈 변수로 두면
 *   백업을 올린 뒤 한쪽만 새 값을 읽어 「로그인 → 바로 로그인 화면」이 된다(2026-09-30 배포 첫날 버그).
 */
const gs = globalThis as unknown as { __academySecret?: string | null };
function getSecret(): string {
  if (process.env.ACADEMY_SECRET) return process.env.ACADEMY_SECRET;
  if (gs.__academySecret) return gs.__academySecret;
  const db = getDb();
  const read = () => (db.prepare("SELECT value FROM app_settings WHERE key = 'session_secret'").get() as { value: string } | undefined)?.value;
  if (!read()) db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('session_secret', ?)").run(randomBytes(32).toString("base64url"));
  return (gs.__academySecret = read()!);
}

/** 백업을 올려 DB가 바뀌면 비밀값을 새 DB에서 다시 읽는다 (모두 다시 로그인) */
export function resetSecret(): void {
  gs.__academySecret = null;
}

/* ------------------------------------------------------------------ 비밀번호 */

/** "scrypt$소금$해시" */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("base64url")}`;
}

/** 해시 · 예전 평문 모두 확인한다 */
export function checkPassword(stored: string, pw: string): boolean {
  if (!stored.startsWith("scrypt$")) {
    const a = Buffer.from(stored);
    const b = Buffer.from(pw);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash, "base64url");
  const got = scryptSync(pw, salt, expected.length);
  return timingSafeEqual(got, expected);
}

/* -------------------------------------------------------------------- 세션 */

type UserRow = {
  id: number;
  login_id: string;
  name: string;
  role: Role;
  roles: string;
  department: Department;
  active: number;
  must_change_pw: number;
  employment: string;
  work_days: string;
  exam_docs: number;
};

const USER_COLS = "id, login_id, name, role, roles, department, active, must_change_pw, employment, work_days, exam_docs";

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
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

/** "1,3,5" → [1,3,5] */
export const parseDays = (s: string | null | undefined) =>
  [...new Set((s ?? "").split(",").filter((x) => x.trim() !== "").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    loginId: row.login_id,
    name: row.name,
    roles: parseRoles(row.roles, row.role),
    department: row.department,
    mustChangePw: row.must_change_pw === 1,
    partTime: row.employment === "PART",
    workDays: parseDays(row.work_days),
    examDocs: row.exam_docs === 1,
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
  if (!checkPassword(row.password, password)) return null;
  // 예전 평문 비밀번호는 이번에 해시로 바꿔 둔다
  if (!row.password.startsWith("scrypt$")) db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashPassword(password), row.id);
  // 배포 서버에서는 처음 비밀번호(1234)로 계속 쓰지 못하게 — 새 비밀번호를 정해야 들어간다
  if (process.env.NODE_ENV === "production" && password === "1234" && row.must_change_pw !== 1) {
    db.prepare("UPDATE users SET must_change_pw = 1 WHERE id = ?").run(row.id);
    row.must_change_pw = 1;
  }
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
