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
    // 반 색은 부서 필터와 상관없이 그 요일 전체 반 기준으로 정한다 (시간표 화면과 같은 색)
    dayClassIds: listSessions(day, "ALL").map((s) => s.classId),
  };
});
