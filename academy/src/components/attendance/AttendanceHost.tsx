"use client";

// 어느 메뉴에 있든 출결·미션지 팝업이 뜨도록 셸에 상주한다. 4초 폴링.
// 팝업은 ① 출석체크, ② 출결전화, 📄 미션지 요청(선생님) — 모두 "나중에" 가 없다. 끝까지 처리해야 사라진다.
// 출결 결과(지각·결석)는 팝업 없이 담당 선생님·관리자 알림함으로만 간다.

import { useCallback, useEffect, useState } from "react";
import CheckPopup from "./CheckPopup";
import CallPopup from "./CallPopup";
import MissionPopup from "./MissionPopup";
import { apiGet } from "@/lib/http";
import type { AttendanceGroup, MissionRequest, SessionUser } from "@/lib/types";

type Payload = { date: string; groups: AttendanceGroup[]; missions: MissionRequest[] };

export default function AttendanceHost({ user }: { user: SessionUser }) {
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);
  const [missions, setMissions] = useState<MissionRequest[]>([]);
  const [muted, setMuted] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Payload>("/api/attendance/pending");
      setGroups(data.groups);
      setMissions(data.missions ?? []);
    } catch {
      /* 폴링 실패는 다음 주기에 회복된다 */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const current = groups[0];
  if (!current) {
    const m = missions[0];
    if (!m) return null;
    const key = `mission-${m.classId}-${m.date}`;
    return (
      <MissionPopup
        key={key}
        user={user}
        request={m}
        muted={muted[key] ?? false}
        onToggleMute={() => setMuted((x) => ({ ...x, [key]: !x[key] }))}
        onDone={() => {
          setMissions((list) => list.filter((x) => x.classId !== m.classId));
          void load();
        }}
      />
    );
  }

  const done = () => {
    setGroups((list) => list.filter((g) => g.key !== current.key));
    void load();
  };
  const common = {
    group: current,
    muted: muted[current.key] ?? false,
    onToggleMute: () => setMuted((m) => ({ ...m, [current.key]: !m[current.key] })),
    onDone: done,
  };

  // key 로 묶음이 바뀌면 입력 상태를 새로 시작한다
  return current.kind === "CHECK" ? <CheckPopup key={current.key} user={user} {...common} /> : <CallPopup key={current.key} {...common} />;
}
