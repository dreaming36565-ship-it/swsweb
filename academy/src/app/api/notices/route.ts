import { readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createNotice, deleteNotice, listNotices, updateNotice, type DeptFilter } from "@/lib/repo";

export const GET = withUser(({ req }) => {
  const dept = (strParam(req, "dept") ?? "ALL") as DeptFilter;
  return { notices: listNotices(dept) };
});

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "notices.write");
  const body = await readJson<{ title?: string; body?: string; department?: string }>(req);
  return {
    id: createNotice({
      title: body.title ?? "",
      body: body.body ?? "",
      department: body.department ?? "ALL",
      authorId: user.id,
    }),
  };
});

/** 공지 고치기 (관리자) */
export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "notices.write");
  const body = await readJson<{ id?: number; title?: string; body?: string; department?: string }>(req);
  assert(body.id, "공지를 찾을 수 없습니다.");
  updateNotice(body.id, { title: body.title ?? "", body: body.body ?? "", department: body.department ?? "ALL" });
  return null;
});

/** 공지 지우기 (관리자) */
export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "notices.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "공지를 찾을 수 없습니다.");
  deleteNotice(body.id);
  return null;
});
