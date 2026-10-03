import { dataVersion, strParam, withUser } from "@/lib/api";
import { adhocRequestsForPopup, missionsForTeacher, pendingGroupsForUser, remindCerts, remindSchedule, remindSchoolExams, srAutoPack, tickAttendance, touchUser } from "@/lib/repo";
import { dateKey, minutesOfDay } from "@/lib/time";
import { dailyBackup } from "@/lib/backup";

/**
 * 4초 폴링 — 이 호출이 tick 역할을 겸한다.
 * 수업·알파 중 먼저 시작하는 쪽 +2분이 지난 수업의 출결을 열고, 내가 처리할 팝업(같은 시각 반 묶음)을 돌려준다.
 * 선생님에게는 📄 미션지 요청 팝업도 함께. 데스크에게는 🙋 SR 자리 요청 팝업. 매달 1일에는 SR 월초 자리 정리를 한 번 한다.
 * 📚 시험 D-40 → 관리자 「시험대비 일정 세워주세요」(1분에 한 번 확인).
 * 하루 한 번 📷 숙제인증 확인 안 된 날을 담당T에게 알린다. 하루 한 번 자동 백업(최근 14개).
 * ver = 자료 버전 — 바뀌면 열려 있는 시간표 · SR 화면이 다시 불러온다.
 * ?n= 그 컴퓨터 윈도우 알림 상태 — 계정 탭의 「학원앱 켜짐 / 알림」 표시용으로 적어 둔다.
 */
export const GET = withUser(({ user, req }) => {
  touchUser(user.id, strParam(req, "n"));
  const now = new Date();
  const date = dateKey(now);
  tickAttendance(date, now.getDay(), minutesOfDay(now));
  srAutoPack();
  remindCerts();
  remindSchoolExams();
  remindSchedule();
  dailyBackup();
  return { date, groups: pendingGroupsForUser(user, date), missions: missionsForTeacher(user), adhocs: adhocRequestsForPopup(user), ver: dataVersion() };
});
