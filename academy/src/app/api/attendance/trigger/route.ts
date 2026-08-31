import { readJson, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { triggerAttendance } from "@/lib/repo";
import { dateKey } from "@/lib/time";

/** 결석관리의 "지금 열기" — 수업 시작 +2분을 기다리지 않고 즉시 시작 */
export const POST = withUser(async ({ user, req }) => {
  assert(user.role === "ADMIN" || user.role === "TEACHER", "출결을 열 권한이 없습니다.");
  const body = await readJson<{ sessionId?: number; date?: string }>(req);
  assert(body.sessionId, "수업을 찾을 수 없습니다.");
  triggerAttendance(body.sessionId, body.date || dateKey(new Date()));
  return null;
});
