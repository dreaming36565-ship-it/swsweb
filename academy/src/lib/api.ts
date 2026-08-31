// API 응답 형식은 항상 { ok: true, data } 또는 { ok: false, error: "한국어 메시지" }.
// 실패 사유는 반드시 화면에 표시된다 — 조용히 무시하지 말 것.

import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "./errors";
import { can, getSessionUser, type Permission } from "./auth";
import type { SessionUser } from "./types";

export function ok(data: unknown = null) {
  return NextResponse.json({ ok: true, data });
}

export function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

type Handler = (ctx: { user: SessionUser; req: NextRequest }) => Promise<unknown> | unknown;

/** 로그인 확인 + 오류를 한국어 메시지로 변환하는 라우트 래퍼 */
export function withUser(handler: Handler) {
  return async (req: NextRequest) => {
    try {
      const user = await getSessionUser();
      if (!user) return fail("로그인이 필요합니다.", 401);
      return ok(await handler({ user, req }));
    } catch (e) {
      if (e instanceof AppError) return fail(e.message, e.status);
      console.error(e);
      return fail("처리 중 오류가 발생했습니다.", 500);
    }
  };
}

export function requirePermission(user: SessionUser, perm: Permission): void {
  if (!can(user, perm)) throw new AppError("이 작업을 할 권한이 없습니다.", 403);
}

export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError("요청 형식이 올바르지 않습니다.");
  }
}

export function numParam(req: NextRequest, key: string): number | null {
  const v = req.nextUrl.searchParams.get(key);
  if (v === null || v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isSafeInteger(n) ? n : null;
}

export function strParam(req: NextRequest, key: string): string | null {
  const v = req.nextUrl.searchParams.get(key);
  return v === null || v === "" ? null : v;
}
