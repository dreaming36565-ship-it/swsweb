"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { apiPost, errorMessage } from "@/lib/http";
import { DEPARTMENTS } from "@/lib/types";

const REMEMBER_KEY = "academy.login.remember";

const DEMO = [
  { loginId: "안예슬", label: "안예슬 (관리자+선생님)" },
  { loginId: "최나영", label: "최나영 (선생님)" },
  { loginId: "정필드", label: "정필드 (고등)" },
  { loginId: "이수민", label: "이수민 (데스크)" },
];

export default function LoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setLoginId(saved);
        setRemember(true);
      }
    } catch {
      /* localStorage 를 못 쓰는 환경 */
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await apiPost("/api/auth/login", { loginId: loginId.trim(), password });
      try {
        if (remember) window.localStorage.setItem(REMEMBER_KEY, loginId.trim());
        else window.localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* 저장 실패는 로그인 자체를 막지 않는다 */
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-white px-6 py-10">
      {/* 아주 연한 블루/퍼플 계열 그래픽 */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-navy-50" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-[#F3F1FC]" />

      <div className="relative grid w-full max-w-5xl grid-cols-1 items-center gap-16 lg:grid-cols-2">
        {/* 왼쪽 — 브랜드 소개 */}
        <div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {(["ELEM", "HIGH"] as const).map((key) => (
              <div key={key} className="flex items-center gap-3">
                <BrandLogo dept={key} size={44} />
                <div>
                  <div className="text-base font-bold text-navy-900">{DEPARTMENTS[key].branch}</div>
                  <div className="text-xs text-muted">{DEPARTMENTS[key].brand}</div>
                </div>
              </div>
            ))}
          </div>

          <h1 className="mt-12 text-4xl font-bold leading-tight tracking-tight text-navy-900">
            스마트한 학원 관리의 시작
          </h1>
          <p className="mt-4 text-lg text-muted">시간표, SR 관리, 학생 운영을 한 번에.</p>
        </div>

        {/* 오른쪽 — 로그인 */}
        <div className="card p-8">
          <h2 className="text-xl font-bold text-ink">로그인</h2>
          <p className="mt-1 text-sm text-muted">아이디 대신 <b>본인 한글 이름</b>을 입력해요.</p>

          <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)}>
            <div>
              <label className="label" htmlFor="loginId">
                이름
              </label>
              <input
                id="loginId"
                className="field"
                value={loginId}
                autoComplete="username"
                placeholder="예) 최나영"
                onChange={(e) => setLoginId(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                className="field"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-navy-800)]"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                이름 저장
              </label>
              <button
                type="button"
                className="text-sm text-navy-600 hover:underline"
                onClick={() =>
                  setNotice("관리자에게 비밀번호 초기화를 부탁하세요 (시간표 › 계정 · 강의실). 초기화하면 1234로 로그인한 뒤 새 비밀번호를 정해요.")
                }
              >
                비밀번호 찾기
              </button>
            </div>

            {error ? (
              <div className="rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="rounded-lg border border-line bg-navy-50 px-3 py-2 text-sm text-navy-700">
                {notice}
              </div>
            ) : null}

            <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
              {busy ? "로그인 중…" : "로그인"}
            </button>
          </form>

          <div className="mt-6 border-t border-line pt-4">
            <div className="text-xs font-semibold text-muted">데모 계정 (비밀번호 1234)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.loginId}
                  type="button"
                  className="btn px-2.5 py-1 text-xs"
                  onClick={() => {
                    setLoginId(d.loginId);
                    setPassword("1234");
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
