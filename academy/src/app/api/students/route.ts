import { numParam, readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { deleteStudent, listStudents, updateStudent, type DeptFilter } from "@/lib/repo";

export const GET = withUser(({ req }) => {
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return { students: listStudents(dept, numParam(req, "classId")) };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{ id?: number; name?: string; department?: string }>(req);
  assert(body.id, "학생을 찾을 수 없습니다.");
  updateStudent(body.id, body);
  return null;
});

/** 학생 완전 삭제 (퇴원) — 관리자 */
export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "학생을 찾을 수 없습니다.");
  deleteStudent(body.id);
  return null;
});
