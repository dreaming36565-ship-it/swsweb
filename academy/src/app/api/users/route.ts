import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createUser, deleteUser, listUsers, updateUser } from "@/lib/repo";

export const GET = withUser(({ user }) => {
  requirePermission(user, "users.write");
  return { users: listUsers() };
});

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "users.write");
  const body = await readJson<{
    loginId?: string;
    password?: string;
    name?: string;
    role?: string;
    department?: string;
  }>(req);
  return {
    id: createUser({
      loginId: body.loginId ?? "",
      password: body.password ?? "",
      name: body.name ?? "",
      role: body.role ?? "TEACHER",
      department: body.department ?? "ELEM",
    }),
  };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "users.write");
  const body = await readJson<{
    id?: number;
    name?: string;
    role?: string;
    department?: string;
    password?: string;
    active?: number;
  }>(req);
  assert(body.id, "계정을 찾을 수 없습니다.");
  updateUser(body.id, body);
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "users.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "계정을 찾을 수 없습니다.");
  deleteUser(body.id, user.id);
  return null;
});
