import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createBooking, deleteBooking } from "@/lib/repo";

/** 교실배정 · 사용 표시 (그 날짜 하루만) — 관리자 · 데스크 */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "rooms.booking");
  const body = await readJson<{ date?: string; roomId?: number; start?: number; end?: number; name?: string; headcount?: number | null; teacherId?: number | null }>(req);
  assert(body.date && body.roomId && body.start !== undefined && body.end !== undefined, "날짜 · 교실 · 시간을 확인해 주세요.");
  return {
    id: createBooking(user.id, {
      date: body.date,
      roomId: body.roomId,
      start: body.start,
      end: body.end,
      name: body.name ?? "",
      headcount: body.headcount ?? null,
      teacherId: body.teacherId ?? null,
    }),
  };
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "rooms.booking");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "교실배정을 찾을 수 없습니다.");
  deleteBooking(body.id);
  return null;
});
