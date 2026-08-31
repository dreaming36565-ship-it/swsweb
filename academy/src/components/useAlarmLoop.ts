"use client";

import { useEffect } from "react";
import { playAlarm } from "@/lib/alarm";

/**
 * 출결 팝업 알림음 — 팝업이 뜨는 순간 울리고,
 * 제출 전까지 1분마다 3초씩 반복한다.
 * 최종확인(TEACHER_CONFIRM) 단계는 대상이 아니다 — 호출하는 쪽에서 active 로 거른다.
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
