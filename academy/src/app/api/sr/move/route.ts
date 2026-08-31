import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { srMove } from "@/lib/repo";

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "sr.move");
  const body = await readJson<{ assignmentId?: number; seat?: string }>(req);
  assert(body.assignmentId, "좌석 배정을 찾을 수 없습니다.");
  assert(body.seat, "이동할 좌석을 선택해 주세요.");
  srMove(body.assignmentId, body.seat);
  return null;
});
