import { numParam, strParam, withUser } from "@/lib/api";
import {
  conflictsForDay,
  listClasses,
  listRooms,
  listSessions,
  listSrAssignments,
  listTeachers,
  type DeptFilter,
} from "@/lib/repo";

/** 시간표 화면이 필요한 데이터를 한 번에 내려준다 */
export const GET = withUser(({ req }) => {
  const day = numParam(req, "day") ?? new Date().getDay();
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return {
    day,
    dept,
    sessions: listSessions(day, dept),
    rooms: listRooms(),
    classes: listClasses(dept),
    teachers: listTeachers("ALL"),
    srAssignments: listSrAssignments(day, dept),
    conflicts: conflictsForDay(day),
  };
});
