import { readJson, withUser } from "@/lib/api";
import { triggerAttendance } from "@/lib/repo";
import { dateKey } from "@/lib/time";

/**
 * 결석관리의 "지금 열기" — 시작 +2분을 기다리지 않고 즉시 시작. 같은 시각의 반들을 한 번에 연다.
 * 선생님·데스크·관리자 누구나 열 수 있다 (자동으로 열렸어야 할 출결을 놓쳤을 때 쓰는 버튼).
 */
export const POST = withUser(async ({ req }) => {
  const body = await readJson<{ sessionIds?: number[]; date?: string }>(req);
  triggerAttendance(body.sessionIds ?? [], body.date || dateKey(new Date()));
  return null;
});
