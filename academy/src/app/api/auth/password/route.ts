import { readJson, withUser } from "@/lib/api";
import { changePassword } from "@/lib/repo";

/** 내 비밀번호 바꾸기 — 처음 비밀번호(1234)로 로그인했으면 지금 비밀번호 없이 */
export const POST = withUser(async ({ user, req }) => {
  const body = await readJson<{ current?: string; next?: string }>(req);
  changePassword(user.id, body.next ?? "", body.current ?? null);
  return null;
});
