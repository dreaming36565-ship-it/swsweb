import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, makeToken, verifyLogin } from "@/lib/auth";

/** 비밀번호를 여러 번 틀리면 잠깐 막는다 (인터넷에 올린 뒤 비밀번호 마구 넣어 보기 막기) — 이름마다 10분에 10번 */
const FAIL_LIMIT = 10;
const FAIL_WINDOW = 10 * 60 * 1000;
const fails = new Map<string, number[]>();
const recent = (key: string) => (fails.get(key) ?? []).filter((t) => Date.now() - t < FAIL_WINDOW);

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
    return NextResponse.json({ ok: false, error: "이름과 비밀번호를 입력해 주세요." }, { status: 400 });
  }

  const key = loginId.toLowerCase();
  if (recent(key).length >= FAIL_LIMIT) {
    return NextResponse.json({ ok: false, error: "비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요." }, { status: 429 });
  }

  const user = verifyLogin(loginId, password);
  if (!user) {
    fails.set(key, [...recent(key), Date.now()]);
    return NextResponse.json(
      { ok: false, error: "이름 또는 비밀번호가 맞지 않아요." },
      { status: 401 },
    );
  }
  fails.delete(key);

  const jar = await cookies();
  jar.set(COOKIE_NAME, makeToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    // 배포 서버는 https — 쿠키가 암호화된 연결로만 오간다
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return NextResponse.json({ ok: true, data: user });
}
