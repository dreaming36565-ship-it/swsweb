import { readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createTask, deleteTask, listTasks, listUsers, setTaskDone } from "@/lib/repo";

export const GET = withUser(({ user, req }) => {
  const all = strParam(req, "scope") === "all" && user.role === "ADMIN";
  return {
    tasks: listTasks({ assigneeId: user.id, all }),
    users: user.role === "ADMIN" ? listUsers() : [],
  };
});

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "tasks.write");
  const body = await readJson<{ assigneeId?: number; title?: string; dueDate?: string | null }>(req);
  assert(body.assigneeId, "담당자를 선택해 주세요.");
  return {
    id: createTask({
      assigneeId: body.assigneeId,
      createdBy: user.id,
      title: body.title ?? "",
      dueDate: body.dueDate ?? null,
    }),
  };
});

export const PATCH = withUser(async ({ user, req }) => {
  const body = await readJson<{ id?: number; done?: boolean }>(req);
  assert(body.id, "업무를 찾을 수 없습니다.");
  setTaskDone(body.id, body.done === true, user);
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "tasks.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "업무를 찾을 수 없습니다.");
  deleteTask(body.id);
  return null;
});
