"use client";

import { useEffect, useState } from "react";
import { formatClock, formatDateKorean } from "@/lib/time";

/** 대시보드 우측의 큰 실시간 날짜/시계 — 1초마다 갱신 */
export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="text-right">
      <div className="text-lg font-semibold text-muted">
        {now ? formatDateKorean(now) : " "}
      </div>
      <div className="mt-1 text-5xl font-bold tracking-tight text-navy-900 tabular-nums">
        {now ? formatClock(now) : " "}
      </div>
    </div>
  );
}
