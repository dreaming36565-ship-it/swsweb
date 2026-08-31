import { numParam, strParam, withUser } from "@/lib/api";
import { listSessions, listSrAssignments, type DeptFilter } from "@/lib/repo";

export const GET = withUser(({ req }) => {
  const day = numParam(req, "day") ?? new Date().getDay();
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return {
    day,
    dept,
    assignments: listSrAssignments(day, dept),
    sessions: listSessions(day, dept),
  };
});
