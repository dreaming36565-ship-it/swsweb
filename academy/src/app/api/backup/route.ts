import { NextResponse, type NextRequest } from "next/server";
import { requirePermission, withUser } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/perm";
import { backupNow, listBackups, readBackup, restoreFrom } from "@/lib/backup";
import { volumeMissing } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dateKey } from "@/lib/time";

/**
 * 백업 (관리자)
 * GET ?list=1 → 자동 백업 목록 · GET → 지금 DB 파일 받기 · GET ?file=이름 → 자동 백업 받기
 * POST (form-data: file) → 백업 올리기(복원)
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  if (!can(user, "users.write")) return NextResponse.json({ ok: false, error: "백업은 관리자만 받을 수 있어요." }, { status: 403 });
  const q = req.nextUrl.searchParams;
  if (q.get("list")) return NextResponse.json({ ok: true, data: { backups: listBackups(), volumeMissing } });
  try {
    const name = q.get("file");
    const buf = name ? readBackup(name) : backupNow();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name ?? `academy-backup-${dateKey(new Date())}.db`}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "백업 파일을 만들지 못했어요.";
    if (!(e instanceof AppError)) console.error(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

const MAX = 100 * 1024 * 1024;

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "users.write");
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    throw new AppError("파일을 읽지 못했어요.");
  }
  if (!file) throw new AppError("백업 파일(.db)을 골라 주세요.");
  if (file.size > MAX) throw new AppError("파일이 너무 커요 (100MB까지).");
  restoreFrom(Buffer.from(await file.arrayBuffer()));
  return null;
});
