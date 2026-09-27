"use client";

import { useEffect } from "react";
import { playAlarm } from "@/lib/alarm";

/**
 * 출결 팝업 알림음 — 팝업이 뜨는 순간 울리고,
 * 제출 전까지 1분마다 3초씩 반복한다.
 * 출석체크·출결전화 팝업이 쓴다 (출결 결과는 팝업이 없어 알림음도 없다).
 */
export function useAlarmLoop(active: boolean, muted = false): void {
  useEffect(() => {
    if (!active || muted) return;

    let stop = playAlarm(3);
    const timer = setInterval(() => {
      stop();
      stop = playAlarm(3);
    }, 60_000);

    return () => {
      stop();
      clearInterval(timer);
    };
  }, [active, muted]);
}
