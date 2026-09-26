import { numParam, strParam, withUser } from "@/lib/api";
import {
  conflictsForDay,
  listClasses,
  listMakeups,
  listRooms,
  listSessions,
  listSrAssignments,
  listTeachers,
  type DeptFilter,
} from "@/lib/repo";
import { dateKey } from "@/lib/time";

/** 시간표 화면이 필요한 데이터를 한 번에 내려준다 */
export const GET = withUser(({ req }) => {
  const day = numParam(req, "day") ?? new Date().getDay();
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return {
    day,
    dept,
    sessions: listSessions(day, dept),
    // 반 색은 부서 필터와 상관없이 그 요일 전체 반 기준으로 정한다 (SR 화면과 같은 색)
    dayClassIds: listSessions(day, "ALL").map((s) => s.classId),
    rooms: listRooms(),
    classes: listClasses(dept),
    teachers: listTeachers("ALL"),
    srAssignments: listSrAssignments(day, dept),
    conflicts: conflictsForDay(day),
    // 앞으로 예정된 보강 — 요일이 맞는 것만 시간표에 함께 그린다
    makeups: listMakeups({ dept, fromDate: dateKey(new Date()), status: "PLANNED" }),
  };
});
