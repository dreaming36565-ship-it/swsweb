import { numParam, readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createStudent, deleteStudent, listStudents, updateStudent, type DeptFilter } from "@/lib/repo";

export const GET = withUser(({ req }) => {
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return { students: listStudents(dept, numParam(req, "classId")) };
});

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{ name?: string; department?: string; classId?: number | null }>(req);
  return {
    id: createStudent({
      name: body.name ?? "",
      department: body.department ?? "ELEM",
      classId: body.classId ?? null,
    }),
  };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{ id?: number; name?: string; classId?: number | null; department?: string }>(req);
  assert(body.id, "학생을 찾을 수 없습니다.");
  updateStudent(body.id, body);
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "학생을 찾을 수 없습니다.");
  deleteStudent(body.id);
  return null;
});
