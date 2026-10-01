"use client";

// 다른 컴퓨터 · 다른 탭에서 시간표 · 반 · SR 자리를 고치면 4초 폴링이 알려 준다 (AttendanceHost).
// 화면은 useDataChanged(reload) 로 듣고 다시 불러온다 — 새로고침 없이 바로 반영.

import { useEffect } from "react";

export const DATA_CHANGED = "academy:data-changed";

export function useDataChanged(reload: () => void): void {
  useEffect(() => {
    const on = () => reload();
    window.addEventListener(DATA_CHANGED, on);
    return () => window.removeEventListener(DATA_CHANGED, on);
  }, [reload]);
}
