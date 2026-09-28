import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createBook, deleteBook, findOrCreateBook, listBooks, updateBook } from "@/lib/repo";

export const GET = withUser(() => ({ books: listBooks() }));

/** 교재 추가 — { level, grade, name } 또는 한 줄 { text: "초등 5-1 심화" } (있으면 그 교재) */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "books.write");
  const body = await readJson<{ level?: string; grade?: string; name?: string; text?: string }>(req);
  if (body.text !== undefined) return { id: findOrCreateBook(body.text) };
  return { id: createBook({ level: body.level ?? "", grade: body.grade ?? "", name: body.name ?? "" }) };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "books.write");
  const body = await readJson<{ id?: number; level?: string; grade?: string; name?: string }>(req);
  assert(body.id, "교재를 찾을 수 없습니다.");
  updateBook(body.id, { level: body.level ?? "", grade: body.grade ?? "", name: body.name ?? "" });
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "books.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "교재를 찾을 수 없습니다.");
  deleteBook(body.id);
  return null;
});
