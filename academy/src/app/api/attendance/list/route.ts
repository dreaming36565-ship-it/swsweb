import { strParam, withUser } from "@/lib/api";
import {
  attendanceSummary,
  listAttendance,
  listAttendanceByIds,
  notOpenedSessions,
  type DeptFilter,
} from "@/lib/repo";
import { dateKey, parseDateKey } from "@/lib/time";

export const GET = withUser(({ req }) => {
  // 알림함에서 결과를 펼칠 때 — 알림에 담긴 출결만 돌려준다
  const ids = strParam(req, "events");
  if (ids) {
    const list = ids.split(",").map(Number).filter(Number.isSafeInteger);
    return { events: listAttendanceByIds(list) };
  }

  const date = strParam(req, "date") ?? dateKey(new Date());
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  const dayOfWeek = parseDateKey(date).getDay();
  return {
    date,
    dept,
    events: listAttendance(date, dept),
    notOpened: notOpenedSessions(date, dayOfWeek, dept),
    summary: attendanceSummary(date, dept),
  };
});
