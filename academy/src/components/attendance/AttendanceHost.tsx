"use client";

// 어느 메뉴에 있든 출결 팝업이 뜨도록 셸에 상주한다. 4초 폴링.
// 팝업을 "나중에" 로 닫아도 3분 뒤 다시 뜨고, 알림 종에는 기록이 남는다.

import { useCallback, useEffect, useState } from "react";
import TeacherCheckPopup from "./TeacherCheckPopup";
import DeskCallPopup from "./DeskCallPopup";
import TeacherConfirmPopup from "./TeacherConfirmPopup";
import { apiGet } from "@/lib/http";
import type { AttendanceEvent, SessionUser } from "@/lib/types";

const SNOOZE_MS = 3 * 60 * 1000;

type Payload = { date: string; events: AttendanceEvent[] };

export default function AttendanceHost({ user }: { user: SessionUser }) {
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [snoozed, setSnoozed] = useState<Record<number, number>>({});
  const [muted, setMuted] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Payload>("/api/attendance/pending");
      setEvents(data.events);
    } catch {
      /* 폴링 실패는 다음 주기에 회복된다 */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const now = Date.now();
  const current = events.find((e) => (snoozed[e.id] ?? 0) < now);

  if (!current) return null;

  const later = () => setSnoozed((s) => ({ ...s, [current.id]: Date.now() + SNOOZE_MS }));
  const done = () => {
    setEvents((list) => list.filter((e) => e.id !== current.id));
    void load();
  };
  const toggleMute = () => setMuted((m) => ({ ...m, [current.id]: !m[current.id] }));

  const common = {
    event: current,
    muted: muted[current.id] ?? false,
    onToggleMute: toggleMute,
    onLater: later,
    onDone: done,
  };

  if (current.stage === "TEACHER_PENDING") return <TeacherCheckPopup {...common} />;
  if (current.stage === "DESK_PENDING") return <DeskCallPopup {...common} />;
  if (current.stage === "TEACHER_CONFIRM") return <TeacherConfirmPopup {...common} />;
  return null;
}
