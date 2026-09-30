import { readJson, requirePermission, withUser } from "@/lib/api";
import { saveSnapshot } from "@/lib/repo";

/** 📸 분기 마감 저장 — 지금 시간표를 교체 비교 기준으로 저장 (관리자) */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  const body = await readJson<{ label?: string }>(req);
  saveSnapshot(body.label ?? "");
  return null;
});
