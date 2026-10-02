// 📄 기출분석 — 문서 HTML (로그인 + 메뉴 권한). 화면의 iframe 이 연다
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { examDocsAccess } from "@/lib/perm";
import { readExamDocHtml } from "@/lib/repo";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !examDocsAccess(user)) return new NextResponse("권한이 없습니다.", { status: 403 });
  const html = readExamDocHtml(req.nextUrl.searchParams.get("id") ?? "");
  if (html === null) return new NextResponse("문서를 찾을 수 없습니다.", { status: 404 });
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
