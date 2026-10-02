// 📄 기출분석 — 학원 컴퓨터(exam-reports/sync_edits.py) 전용. 로그인 대신 연결 열쇠(X-Sync-Key)
//   GET                       → 반영됐지만 PDF에 안 들어간 수정
//   PUT  ?id&grp&name&kind&order + 본문 HTML → 문서 올리기(바꾸기)
//   POST { synced: [id…] }     → PDF에 넣었다고 표시
import { NextResponse, type NextRequest } from "next/server";
import { checkExamSyncKey, examUnsynced, markExamSynced, putExamDoc } from "@/lib/repo";
import { AppError } from "@/lib/errors";

const ok = (data: unknown) => NextResponse.json({ ok: true, data });
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

async function guard(req: NextRequest, fn: () => Promise<unknown> | unknown) {
  if (!checkExamSyncKey(req.headers.get("x-sync-key"))) return fail("연결 열쇠가 맞지 않습니다.", 401);
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof AppError) return fail(e.message, e.status);
    console.error(e);
    return fail("처리 중 오류가 발생했습니다.", 500);
  }
}

export const GET = (req: NextRequest) => guard(req, () => ({ edits: examUnsynced() }));

export const PUT = (req: NextRequest) =>
  guard(req, async () => {
    const q = req.nextUrl.searchParams;
    putExamDoc(
      { id: q.get("id") ?? "", grp: q.get("grp") ?? "", name: q.get("name") ?? "", kind: q.get("kind") ?? "", orderNo: Number(q.get("order") ?? 0) || 0 },
      await req.text(),
    );
    return null;
  });

export const POST = (req: NextRequest) =>
  guard(req, async () => {
    const b = (await req.json().catch(() => ({}))) as { synced?: number[] };
    return { count: markExamSynced((b.synced ?? []).map(Number).filter((n) => n > 0)) };
  });
