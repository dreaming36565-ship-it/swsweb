import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createUser, deleteUser, listUsers, resetPassword, setPasswordByAdmin, updateUser } from "@/lib/repo";

export const GET = withUser(({ user }) => {
  requirePermission(user, "users.write");
  return { users: listUsers() };
});

/** 새 계정 — 아이디 = 한글 이름, 처음 비밀번호 1234 */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "users.write");
  const body = await readJson<{ name?: string; roles?: string[]; department?: string }>(req);
  return { id: createUser({ name: body.name ?? "", roles: body.roles ?? ["TEACHER"], department: body.department ?? "ELEM" }) };
});

/** 이름 · 권한(여러 개) · 소속 · 사용 여부 · 근무(정직원/알바 + 근무 요일) · 비밀번호 초기화(resetPassword: true) · 비밀번호 정해 주기(password) */
export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "users.write");
  const body = await readJson<{
    id?: number;
    name?: string;
    roles?: string[];
    department?: string;
    active?: number;
    partTime?: boolean;
    workDays?: number[];
    resetPassword?: boolean;
    password?: string;
  }>(req);
  assert(body.id, "계정을 찾을 수 없습니다.");
  if (body.resetPassword) resetPassword(body.id);
  else if (body.password !== undefined) setPasswordByAdmin(body.id, body.password);
  else updateUser(body.id, body);
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "users.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "계정을 찾을 수 없습니다.");
  deleteUser(body.id, user.id);
  return null;
});
