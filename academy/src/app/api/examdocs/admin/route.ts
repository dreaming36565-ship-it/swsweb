// 📄 기출분석 — 관리자: 확인 대기 · 수정 기록 · 반영/거절 · 보이는 사람 · 학원 컴퓨터 연결
import { readJson, strParam, withUser } from "@/lib/api";
import { AppError, assert } from "@/lib/errors";
import { examDocsAccess } from "@/lib/perm";
import {
  decideExamEdits,
  examSyncKey,
  examUnsynced,
  lastExamSync,
  listExamDocUsers,
  listExamEdits,
  newExamSyncKey,
  setExamDocUser,
  type ExamEditStatus,
} from "@/lib/repo";
import type { SessionUser } from "@/lib/types";

function admin(user: SessionUser) {
  if (examDocsAccess(user) !== "ADMIN") throw new AppError("관리자만 볼 수 있습니다.", 403);
}

export const GET = withUser(({ user, req }) => {
  admin(user);
  const what = strParam(req, "what");
  if (what === "users") return { users: listExamDocUsers() };
  if (what === "sync") return { key: examSyncKey(), unsynced: examUnsynced(), last: lastExamSync() };
  const status = strParam(req, "status") as ExamEditStatus | null;
  return { edits: listExamEdits(status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? status : null) };
});

export const POST = withUser(async ({ user, req }) => {
  admin(user);
  const b = await readJson<{ action?: string; ids?: number[]; status?: string; userId?: number; on?: boolean }>(req);
  if (b.action === "decide") {
    assert(b.status === "APPROVED" || b.status === "REJECTED", "요청 형식이 올바르지 않습니다.");
    const ids = (b.ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
    assert(ids.length, "고를 수정이 없습니다.");
    return { count: decideExamEdits(user, ids, b.status) };
  }
  if (b.action === "user") {
    assert(b.userId, "직원을 찾을 수 없습니다.");
    setExamDocUser(b.userId, !!b.on);
    return null;
  }
  if (b.action === "newKey") return { key: newExamSyncKey() };
  throw new AppError("요청 형식이 올바르지 않습니다.");
});
