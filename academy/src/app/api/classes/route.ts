import { readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  createClass,
  deleteClass,
  listClasses,
  listRooms,
  listStudents,
  listTeachers,
  updateClass,
  type DeptFilter,
} from "@/lib/repo";

/** 반 관리 화면이 필요한 데이터를 한 번에 내려준다 */
export const GET = withUser(({ req }) => {
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return {
    dept,
    classes: listClasses(dept),
    rooms: listRooms(),
    teachers: listTeachers("ALL"),
    // 다른 부서 학생도 개별반에 넣을 수 있도록 학생은 전체를 내려준다
    students: listStudents("ALL"),
  };
});

type Body = {
  id?: number;
  name?: string;
  department?: string;
  teacherId?: number | null;
  roomId?: number | null;
  grade?: string | null;
  textbook?: string | null;
};

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "classes.write");
  const body = await readJson<Body>(req);
  return {
    id: createClass({
      name: body.name ?? "",
      department: body.department ?? "ELEM",
      teacherId: body.teacherId ?? null,
      roomId: body.roomId ?? null,
      grade: body.grade ?? null,
      textbook: body.textbook ?? null,
    }),
  };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "classes.write");
  const body = await readJson<Body>(req);
  assert(body.id, "반을 찾을 수 없습니다.");
  updateClass(body.id, body);
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "classes.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "반을 찾을 수 없습니다.");
  deleteClass(body.id);
  return null;
});
