"use client";

// 이 컴퓨터에 윈도우 알림이 꺼져 있으면 상단바 아래 얇은 안내 띠 — 소리를 꺼 둬도 출석체크를 놓치지 않게.
// 팝업을 받는 사람(선생님 · 데스크)에게만. 켜면 사라진다. 📌 앱으로 설치(PWA)도 여기서 잡아 둔다.

import { useEffect, useState } from "react";
import { askNotify, notifyState, type NotifyState } from "@/lib/desktopNotify";
import { hasRole, type SessionUser } from "@/lib/types";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const g = globalThis as unknown as { __installPrompt?: InstallEvent | null; __installHooked?: boolean };

/** 크롬이 「앱으로 설치」를 할 수 있을 때 주는 이벤트를 잡아 둔다 (설정 › 알림에서 씀) */
export function hookInstallPrompt(): void {
  if (typeof window === "undefined" || g.__installHooked) return;
  g.__installHooked = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    g.__installPrompt = e as InstallEvent;
  });
  window.addEventListener("appinstalled", () => {
    g.__installPrompt = null;
  });
}

/** 📌 앱으로 설치 — 설치 창을 띄웠으면 true, 크롬이 아직 준비 안 됐거나 이미 설치했으면 false */
export async function promptInstall(): Promise<boolean> {
  const e = g.__installPrompt;
  if (!e) return false;
  await e.prompt();
  g.__installPrompt = null;
  return true;
}

/** 이미 앱 창으로 열려 있나 */
export const runningAsApp = () => typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;

export default function NotifyBanner({ user }: { user: SessionUser }) {
  const [state, setState] = useState<NotifyState>("granted");
  useEffect(() => {
    hookInstallPrompt();
    setState(notifyState());
    // 크롬 설정에서 바꿀 수도 있어서 가끔 다시 본다
    const t = setInterval(() => setState(notifyState()), 10_000);
    return () => clearInterval(t);
  }, []);

  if (!hasRole(user, "TEACHER") && !hasRole(user, "DESK")) return null;
  if (state === "granted" || state === "none") return null;
  return (
    <div className="flex items-center gap-3 border-b border-late bg-late-soft px-6 py-2 text-sm text-late print:hidden">
      {state === "default" ? (
        <>
          <span>
            🔔 <b>이 컴퓨터 알림이 꺼져 있어요.</b> 소리를 꺼 둬도 출석체크를 놓치지 않게 켜 주세요.
          </span>
          <button type="button" className="btn btn-primary ml-auto py-1 text-xs" onClick={() => void askNotify().then(setState)}>
            알림 켜기
          </button>
        </>
      ) : (
        <span>
          🔕 <b>이 컴퓨터 알림이 차단돼 있어요.</b> 주소창 왼쪽 <b>자물쇠(🔒) › 알림 › 허용</b>으로 바꾼 뒤 새로고침해 주세요.
        </span>
      )}
    </div>
  );
}
