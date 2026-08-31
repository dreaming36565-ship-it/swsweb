import { strParam, withUser } from "@/lib/api";
import { attendanceSummary, listAttendance, notOpenedSessions, type DeptFilter } from "@/lib/repo";
import { dateKey, parseDateKey } from "@/lib/time";

export const GET = withUser(({ req }) => {
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
