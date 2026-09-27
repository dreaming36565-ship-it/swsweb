import { withUser } from "@/lib/api";
import { pendingGroupsForUser, tickAttendance } from "@/lib/repo";
import { dateKey, minutesOfDay } from "@/lib/time";

/**
 * 4초 폴링 — 이 호출이 tick 역할을 겸한다.
 * 수업·알파 중 먼저 시작하는 쪽 +2분이 지난 수업의 출결을 열고, 내가 처리할 팝업(같은 시각 반 묶음)을 돌려준다.
 */
export const GET = withUser(({ user }) => {
  const now = new Date();
  const date = dateKey(now);
  tickAttendance(date, now.getDay(), minutesOfDay(now));
  return { date, groups: pendingGroupsForUser(user, date) };
});
