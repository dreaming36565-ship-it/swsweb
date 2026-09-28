// ★ 서버 전용. repo/*.ts 가 함께 쓰는 도우미.

import { getDb } from "../db";
import { parseRoles } from "../auth";
import { dateKey, minutesOfDay } from "../time";
import type { Department, Role, SessionUser } from "../types";

// node:sqlite 는 null 프로토타입 객체를 돌려준다.
// 그대로 클라이언트 컴포넌트에 넘기면 React 가 거부하므로 평범한 객체로 복사한다.
export const rows = <T>(v: unknown): T[] => (v as T[]).map((r) => ({ ...r }));
export const row = <T>(v: unknown): T | undefined => (v === undefined || v === null ? undefined : ({ ...(v as T) } as T));
export const nowIso = () => new Date().toISOString();
export const today = () => dateKey(new Date());
export const nowMin = () => minutesOfDay(new Date());

/** 여러 줄을 한 번에 바꿀 때 — 중간에 실패하면 전부 되돌린다 (안에서 또 부르면 바깥 트랜잭션에 합친다) */
let depth = 0;
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  if (depth > 0) return fn();
  db.exec("BEGIN");
  depth += 1;
  try {
    const out = fn();
    depth -= 1;
    db.exec("COMMIT");
    return out;
  } catch (e) {
    depth -= 1;
    db.exec("ROLLBACK");
    throw e;
  }
}

/** dept 필터는 "ALL" 문자열을 쓴다. null/undefined 도 전체로 본다. */
export type DeptFilter = Department | "ALL" | null;

export function deptWhere(column: string, dept: DeptFilter): { sql: string; args: string[] } {
  if (!dept || dept === "ALL") return { sql: "", args: [] };
  return { sql: ` AND ${column} = ?`, args: [dept] };
}

export function notify(userId: number, kind: string, title: string, body: string, link: string): void {
  getDb()
    .prepare("INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, kind, title, body, link, nowIso());
}

/** 그 권한을 가진 활성 직원 id */
export function userIdsWithRole(role: Role): number[] {
  return rows<{ id: number; role: string; roles: string }>(
    getDb().prepare("SELECT id, role, roles FROM users WHERE active = 1").all(),
  )
    .filter((u) => parseRoles(u.roles, u.role).includes(role))
    .map((u) => u.id);
}

export const isRole = (u: SessionUser, r: Role) => u.roles.includes(r);

export function getSetting(key: string): string | null {
  return row<{ value: string | null }>(getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key))?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  getDb().prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
