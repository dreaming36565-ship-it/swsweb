import { readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { createNotice, listNotices, type DeptFilter } from "@/lib/repo";

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
