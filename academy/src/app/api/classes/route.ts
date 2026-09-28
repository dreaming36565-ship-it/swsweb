import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { deleteClass, listClasses, saveClass, syncRoster, type ClassInput } from "@/lib/repo";

export const GET = withUser(() => ({ classes: listClasses("ALL") }));

/** 반 저장 (새 반 / 편집) — 반 정보 + 칸 + 학생 (관리자) */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  const body = await readJson<ClassInput>(req);
  return { id: saveClass(body) };
});

/** 반 학생 명단 고치기 — 관리자 · 선생님 · 데스크 */
export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{ id?: number; students?: string[] }>(req);
  assert(body.id, "반을 찾을 수 없습니다.");
  syncRoster(body.id, body.students ?? []);
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "반을 찾을 수 없습니다.");
  deleteClass(body.id);
  return null;
});
