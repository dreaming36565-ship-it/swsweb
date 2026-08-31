import { readJson, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { submitAttendance, type SubmitRecord } from "@/lib/repo";

type Body = {
  eventId?: number;
  step?: "TEACHER" | "DESK" | "CONFIRM";
  records?: SubmitRecord[];
};

export const POST = withUser(async ({ user, req }) => {
  const body = await readJson<Body>(req);
  assert(body.eventId, "출결 정보를 찾을 수 없습니다.");
  assert(body.step, "처리 단계가 지정되지 않았습니다.");
  submitAttendance(user, body.eventId, body.step, body.records ?? []);
  return null;
});
