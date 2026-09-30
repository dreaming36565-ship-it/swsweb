"use client";

// ★ 사이드바 + 상단바 + 출결·미션지 팝업 호스트 + 오디오 unlock.
// 로그인한 직원의 소속 부서에 따라 브랜드가 자동 전환된다. 메뉴는 권한(여러 개)을 합쳐서 보여준다.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandLogo from "./BrandLogo";
import NotificationBell from "./NotificationBell";
import NotifyBanner from "./NotifyBanner";
import { ConfirmProvider } from "./ConfirmDialog";
import AttendanceHost from "./attendance/AttendanceHost";
import {
  IconBook,
  IconCalendar,
  IconCheckSquare,
  IconClipboard,
  IconDashboard,
  IconLogout,
  IconMegaphone,
  IconRefresh,
  IconSeat,
  IconSettings,
} from "./Icons";
import { unlockAudio } from "@/lib/alarm";
import { apiPost, errorMessage } from "@/lib/http";
import { DEPARTMENTS, hasRole, rolesLabel, type SessionUser } from "@/lib/types";

function menuFor(user: SessionUser) {
  const admin = hasRole(user, "ADMIN");
  const desk = hasRole(user, "DESK");
  return [
    { href: "/dashboard", label: "대시보드", Icon: IconDashboard },
    { href: "/timetable", label: admin ? "시간표 관리" : "시간표", Icon: IconCalendar },
    { href: "/sr", label: admin || desk ? "SR 관리" : "SR 현황", Icon: IconSeat },
    { href: "/attendance", label: "결석관리", Icon: IconClipboard },
    { href: "/makeup", label: "보강 관리", Icon: IconRefresh },
    { href: "/homework", label: "숙제 관리", Icon: IconBook },
    { href: "/notices", label: "알림 & 공지", Icon: IconMegaphone },
    { href: "/tasks", label: "업무 지시", Icon: IconCheckSquare },
    { href: "/settings", label: "설정", Icon: IconSettings },
  ];
}

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const brand = DEPARTMENTS[user.department];

  // 브라우저는 사용자 조작 전에는 소리를 못 낸다. 첫 클릭에서 오디오를 열어 둔다.
  useEffect(() => {
    const once = () => unlockAudio();
    window.addEventListener("click", once, { once: true });
    return () => window.removeEventListener("click", once);
  }, []);

  const logout = async () => {
    try {
      await apiPost("/api/auth/logout", {});
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <ConfirmProvider>
      <div className="flex h-screen w-full overflow-hidden print:hidden">
        {/* 사이드바 */}
        <aside className="flex w-60 shrink-0 flex-col bg-navy-900 text-navy-100">
          <div className="flex items-center gap-3 px-5 py-5">
            <BrandLogo dept={user.department} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">{brand.branch}</div>
              <div className="truncate text-xs text-navy-300">{brand.dept}</div>
            </div>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-auto px-3 py-2">
            {menuFor(user).map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? "bg-navy-700 text-white" : "text-navy-200 hover:bg-navy-800 hover:text-white"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-navy-800 px-5 py-4">
            <div className="text-sm font-semibold text-white">{hasRole(user, "TEACHER") ? `${user.name}T` : user.name}</div>
            <div className="text-xs text-navy-300">{rolesLabel(user.roles)}</div>
          </div>
        </aside>

        {/* 본문 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-white px-6">
            <div className="flex items-center gap-3">
              <BrandLogo dept={user.department} size={28} />
              <span className="text-base font-bold text-navy-900">{brand.branch}</span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell user={user} />
              <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
                <IconLogout className="h-4 w-4" />
                로그아웃
              </button>
            </div>
          </header>

          <NotifyBanner user={user} />
          <main className="min-h-0 flex-1 overflow-auto bg-canvas p-6">{children}</main>
        </div>
      </div>

      {user.mustChangePw ? <FirstPassword user={user} /> : <AttendanceHost user={user} />}
    </ConfirmProvider>
  );
}

/** 처음 비밀번호(1234)로 로그인하면 새 비밀번호를 정해야 쓸 수 있다 */
function FirstPassword({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    if (pw !== pw2) return setError("두 비밀번호가 달라요.");
    setBusy(true);
    try {
      await apiPost("/api/auth/password", { next: pw });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-950/60 p-6">
      <form
        className="card w-full max-w-sm p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="text-xl font-bold text-navy-900">새 비밀번호 정하기</h2>
        <p className="mt-1 text-sm text-muted">{user.name} 님, 처음 로그인이라 비밀번호를 바꿔 주세요.</p>
        <label className="label mt-5">새 비밀번호 (4자 이상)</label>
        <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <label className="label mt-3">한 번 더</label>
        <input className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {error ? <div className="mt-3 text-sm font-semibold text-alert">{error}</div> : null}
        <button type="submit" className="btn btn-primary mt-5 w-full" disabled={busy || !pw}>
          {busy ? "저장 중…" : "바꾸고 시작하기"}
        </button>
      </form>
    </div>
  );
}
