import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { srReset } from "@/lib/repo";

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "sr.move");
  const body = await readJson<{ day?: number }>(req);
  assert(body.day !== undefined && body.day >= 0 && body.day <= 6, "요일을 선택해 주세요.");
  srReset(body.day);
  return null;
});
