"use client";

import { useEffect, useRef } from "react";
import { looking, showDesktop } from "@/lib/desktopNotify";

/**
 * 처리해야 할 팝업이 있는 동안 — 학원앱을 안 보고 있으면(다른 창 · 내려 둠)
 * ① 윈도우 알림창(오른쪽 아래 작게)을 바로 + 처리할 때까지 1분마다 다시 띄우고
 * ② 크롬 탭 제목을 「🔴 출석체크!」↔ 원래 제목으로 깜박인다.
 * 알림창을 누르면 학원앱이 앞으로 나오고 onClick (접어 둔 팝업 열기).
 * alert = null 이면 아무것도 안 한다. key 가 바뀌면 새 알림.
 */
export function useDesktopAlert(alert: { key: string; title: string; body: string; short: string } | null, onClick: () => void): void {
  const click = useRef(onClick);
  click.current = onClick;
  const info = useRef(alert);
  info.current = alert;
  const key = alert?.key ?? null;

  useEffect(() => {
    if (!key) return;
    const fire = () => {
      const a = info.current;
      if (a && !looking()) showDesktop({ tag: "academy-popup", title: a.title, body: a.body, onClick: () => click.current() });
    };
    fire();
    const again = setInterval(fire, 60_000);

    const base = document.title;
    let on = false;
    const blink = setInterval(() => {
      if (looking()) {
        on = false;
        document.title = base;
        return;
      }
      on = !on;
      document.title = on ? `🔴 ${info.current?.short ?? "확인해주세요"}` : base;
    }, 1000);

    return () => {
      clearInterval(again);
      clearInterval(blink);
      document.title = base;
    };
  }, [key]);
}
