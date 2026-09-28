import { readJson, requirePermission, withUser } from "@/lib/api";
import { setAlertOk } from "@/lib/repo";

/** 교실 경고(2개반 배정 · 인원초과) 확인 완료 / 되돌리기 — 관리자 */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "rooms.alertOk");
  const body = await readJson<{ key?: string; on?: boolean }>(req);
  setAlertOk(user.id, body.key ?? "", body.on !== false);
  return null;
});
