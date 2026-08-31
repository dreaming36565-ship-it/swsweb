import { readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  createMakeup,
  deleteMakeup,
  listClasses,
  listMakeups,
  listRooms,
  listStudents,
  listTeachers,
  makeupSummary,
  pendingAbsences,
  updateMakeup,
  type DeptFilter,
} from "@/lib/repo";
import type { MakeupStatus } from "@/lib/types";

/** 보강 관리 화면이 필요한 데이터를 한 번에 내려준다 */
export const GET = withUser(({ user, req }) => {
  requirePermission(user, "makeups.read");
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  const onlyUnfinished = strParam(req, "unfinished") === "1";
  return {
    dept,
    makeups: listMakeups({ dept, status: "ALL" }),
    absences: pendingAbsences(dept, onlyUnfinished),
    summary: makeupSummary(dept),
    students: listStudents(dept),
    classes: listClasses(dept),
    rooms: listRooms(),
    teachers: listTeachers("ALL"),
  };
});

type Body = {
  id?: number;
  studentId?: number;
  classId?: number | null;
  absentDate?: string | null;
  date?: string;
  startMin?: number;
  endMin?: number;
  roomId?: number | null;
  teacherId?: number | null;
  note?: string | null;
  status?: MakeupStatus;
};

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "makeups.write");
  const body = await readJson<Body>(req);
  assert(body.studentId, "보강 대상 학생을 선택해 주세요.");
  assert(body.date, "보강 날짜를 선택해 주세요.");
  assert(body.startMin !== undefined && body.endMin !== undefined, "보강 시간을 선택해 주세요.");
  return {
    id: createMakeup({
      studentId: body.studentId,
      classId: body.classId ?? null,
      absentDate: body.absentDate ?? null,
      date: body.date,
      startMin: body.startMin,
      endMin: body.endMin,
      roomId: body.roomId ?? null,
      teacherId: body.teacherId ?? null,
      note: body.note ?? null,
    }),
  };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "makeups.write");
  const body = await readJson<Body>(req);
  assert(body.id, "보강을 찾을 수 없습니다.");
  updateMakeup(body.id, body);
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "makeups.delete");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "보강을 찾을 수 없습니다.");
  deleteMakeup(body.id);
  return null;
});
