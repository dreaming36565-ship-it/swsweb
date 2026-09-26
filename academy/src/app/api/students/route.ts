import { numParam, readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  addStudentToClass,
  createStudent,
  deleteStudent,
  listStudents,
  removeStudentFromClass,
  updateStudent,
  type DeptFilter,
} from "@/lib/repo";

export const GET = withUser(({ req }) => {
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return { students: listStudents(dept, numParam(req, "classId")) };
});

/**
 * 새 학생 등록: { name, department, classIds }
 * 기존 학생을 다른 반에 추가: { studentId, classId }
 */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{
    name?: string;
    department?: string;
    classIds?: number[];
    studentId?: number;
    classId?: number;
  }>(req);
  if (body.studentId) {
    assert(body.classId, "반을 선택해 주세요.");
    addStudentToClass(body.studentId, body.classId);
    return { id: body.studentId };
  }
  return {
    id: createStudent({
      name: body.name ?? "",
      department: body.department ?? "ELEM",
      classIds: body.classIds ?? [],
    }),
  };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{ id?: number; name?: string; department?: string }>(req);
  assert(body.id, "학생을 찾을 수 없습니다.");
  updateStudent(body.id, body);
  return null;
});

/** classId 가 있으면 그 반에서만 빼고, 없으면 학생을 완전히 삭제한다 */
export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "students.write");
  const body = await readJson<{ id?: number; classId?: number }>(req);
  assert(body.id, "학생을 찾을 수 없습니다.");
  if (body.classId) removeStudentFromClass(body.id, body.classId);
  else deleteStudent(body.id);
  return null;
});
