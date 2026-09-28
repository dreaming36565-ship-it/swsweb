import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { resolveTempSwap, swapOrder } from "@/lib/repo";

/**
 * ⇄ 알파·수업 순서 바꾸기 (관리자)
 * - { day, classIds, keep } : 고른 반들을 바꾼다 (keep=false 이번 주 하루만 / true 계속 적용)
 * - { day, classId, action: "UNDO" | "KEEP" } : 이번 주만 바꾼 반 → 원래대로 / 계속 적용으로
 */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.swap");
  const body = await readJson<{ day?: number; classIds?: number[]; keep?: boolean; classId?: number; action?: "UNDO" | "KEEP" }>(req);
  assert(body.day !== undefined && body.day >= 0 && body.day <= 6, "요일을 골라 주세요.");
  if (body.action) {
    assert(body.classId, "반을 찾을 수 없습니다.");
    resolveTempSwap(body.classId, body.day, body.action);
  } else swapOrder(body.day, body.classIds ?? [], body.keep === true);
  return null;
});
