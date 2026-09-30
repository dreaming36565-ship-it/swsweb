"use client";

// 어느 메뉴에 있든 출결·미션지 팝업이 뜨도록 셸에 상주한다. 4초 폴링.
// 팝업은 ① 출석체크, ② 출결전화, 📄 미션지 요청(선생님), 🙋 SR 자리 요청(데스크) — 모두 "나중에" 가 없다. 끝까지 처리해야 사라진다.
// 출결 팝업 두 개는 「접기」로 잠깐 내려 둘 수 있다 — 위쪽 띠가 처리할 때까지 깜박인다.
// 출결 결과(지각·결석)는 팝업 없이 담당 선생님·관리자 알림함으로만 간다.

import { useCallback, useEffect, useState } from "react";
import CheckPopup from "./CheckPopup";
import CallPopup from "./CallPopup";
import MissionPopup from "./MissionPopup";
import AdhocRequestPopup from "../sr/AdhocRequestPopup";
import { apiGet } from "@/lib/http";
import type { AttendanceGroup, MissionRequest, SessionUser } from "@/lib/types";
import type { SrAdhocRequest } from "@/lib/repo/sr";

type Payload = { date: string; groups: AttendanceGroup[]; missions: MissionRequest[]; adhocs?: SrAdhocRequest[] };

export default function AttendanceHost({ user }: { user: SessionUser }) {
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);
  const [missions, setMissions] = useState<MissionRequest[]>([]);
  const [adhocs, setAdhocs] = useState<SrAdhocRequest[]>([]);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  /** 접어 둔 출결 팝업 — 위쪽 띠만 깜박인다 (처리해야 사라짐) */
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Payload>("/api/attendance/pending");
      setGroups(data.groups);
      setMissions(data.missions ?? []);
      setAdhocs(data.adhocs ?? []);
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
    if (!m) {
      const a = adhocs[0];
      if (!a) return null;
      const key = `adhoc-${a.id}`;
      return (
        <AdhocRequestPopup
          key={key}
          request={a}
          alarm
          muted={muted[key] ?? false}
          onToggleMute={() => setMuted((x) => ({ ...x, [key]: !x[key] }))}
          onDone={() => {
            setAdhocs((list) => list.filter((x) => x.id !== a.id));
            void load();
          }}
        />
      );
    }
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
    folded: folded[current.key] ?? false,
    onToggleFold: () => setFolded((m) => ({ ...m, [current.key]: !m[current.key] })),
    onDone: done,
  };

  // key 로 묶음이 바뀌면 입력 상태를 새로 시작한다
  return current.kind === "CHECK" ? <CheckPopup key={current.key} user={user} {...common} /> : <CallPopup key={current.key} {...common} />;
}
