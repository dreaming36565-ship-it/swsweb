import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, makeToken, verifyLogin } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { loginId?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const loginId = (body.loginId ?? "").trim();
  const password = body.password ?? "";
  if (!loginId || !password) {
    return NextResponse.json({ ok: false, error: "아이디와 비밀번호를 입력해 주세요." }, { status: 400 });
  }

  const user = verifyLogin(loginId, password);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  const jar = await cookies();
  jar.set(COOKIE_NAME, makeToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return NextResponse.json({ ok: true, data: user });
}
