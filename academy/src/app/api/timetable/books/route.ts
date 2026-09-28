import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { setPartBooks } from "@/lib/repo";

/** 사용교재 입력 — 반의 한 칸(그 칸의 요일들)에 교재 목록 */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "books.write");
  const body = await readJson<{ classId?: number; days?: number[]; bookIds?: number[] }>(req);
  assert(body.classId && body.days?.length, "칸을 찾을 수 없습니다.");
  setPartBooks(body.classId, body.days, body.bookIds ?? []);
  return null;
});
