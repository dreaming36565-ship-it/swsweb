// 📄 기출분석 — 문서 목록 · 문서에 덮어 보일 문장 · 고친 문장 저장
import { readJson, strParam, withUser } from "@/lib/api";
import { AppError, assert } from "@/lib/errors";
import { examDocsAccess } from "@/lib/perm";
import { examDocOverlay, listExamDocs, submitExamEdits } from "@/lib/repo";
import type { SessionUser } from "@/lib/types";

function access(user: SessionUser) {
  const a = examDocsAccess(user);
  if (!a) throw new AppError("이 메뉴를 볼 권한이 없습니다.", 403);
  return a;
}

export const GET = withUser(({ user, req }) => {
  access(user);
  const doc = strParam(req, "doc");
  if (doc) return { overlay: examDocOverlay(doc) };
  return { docs: listExamDocs() };
});

export const POST = withUser(async ({ user, req }) => {
  const a = access(user);
  const body = await readJson<{ doc?: string; items?: { path?: string; label?: string; before?: string; after?: string }[] }>(req);
  assert(body.doc && Array.isArray(body.items), "요청 형식이 올바르지 않습니다.");
  return { count: submitExamEdits(user, a === "ADMIN", body.doc, body.items), approved: a === "ADMIN" };
});
