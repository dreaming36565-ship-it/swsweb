"use client";

// 어느 메뉴에 있든 출결·미션지 팝업이 뜨도록 셸에 상주한다. 4초 폴링.
// 팝업은 ① 출석체크, ② 출결전화, 📄 미션지 요청(선생님), 🙋 SR 자리 요청(데스크) — 모두 "나중에" 가 없다. 끝까지 처리해야 사라진다.
// 출결 팝업 두 개는 「접기」로 잠깐 내려 둘 수 있다 — 위쪽 띠가 처리할 때까지 깜박인다.
// 출결 결과(지각·결석)는 팝업 없이 담당 선생님·관리자 알림함으로만 간다.
// 학원앱을 안 보고 있으면(다른 창 · 내려 둠) 윈도우 알림창(오른쪽 아래 작게) + 탭 제목 깜박임 — 소리를 꺼 둬도 알 수 있게.

import { useCallback, useEffect, useRef, useState } from "react";
import CheckPopup from "./CheckPopup";
import CallPopup from "./CallPopup";
import MissionPopup from "./MissionPopup";
import AdhocRequestPopup from "../sr/AdhocRequestPopup";
import { apiGet } from "@/lib/http";
import { notifyState } from "@/lib/desktopNotify";
import { fmtTime } from "@/lib/time";
import { useDesktopAlert } from "../useDesktopAlert";
import { DATA_CHANGED } from "@/lib/dataChanged";
import type { AttendanceGroup, MissionRequest, SessionUser } from "@/lib/types";
import type { SrAdhocRequest } from "@/lib/repo/sr";

type Payload = { date: string; groups: AttendanceGroup[]; missions: MissionRequest[]; adhocs?: SrAdhocRequest[]; ver?: number };

export default function AttendanceHost({ user }: { user: SessionUser }) {
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);
  const [missions, setMissions] = useState<MissionRequest[]>([]);
  const [adhocs, setAdhocs] = useState<SrAdhocRequest[]>([]);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  /** 접어 둔 출결 팝업 — 위쪽 띠만 깜박인다 (처리해야 사라짐) */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const ver = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Payload>(`/api/attendance/pending?n=${notifyState()}`);
      setGroups(data.groups);
      setMissions(data.missions ?? []);
      setAdhocs(data.adhocs ?? []);
      // 누가 시간표 · 반 · SR 자리를 고쳤으면 열려 있는 화면에 알린다 (DATA_CHANGED 를 듣는 화면이 다시 불러옴)
      if (data.ver !== undefined) {
        if (ver.current !== null && ver.current !== data.ver) window.dispatchEvent(new Event(DATA_CHANGED));
        ver.current = data.ver;
      }
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
  // 윈도우 알림창에 보일 말 — 지금 떠 있는 팝업 하나
  const m0 = missions[0];
  const a0 = adhocs[0];
  const alert = current
    ? {
        key: current.key,
        title: current.kind === "CHECK" ? "🔔 출석체크해주세요." : "📞 출결전화 돌려주세요.",
        body: `${fmtTime(current.triggerMin)} · ${current.events.map((e) => e.className).join(", ")} — 누르면 바로 열려요`,
        short: current.kind === "CHECK" ? "출석체크!" : "출결전화!",
      }
    : m0
      ? { key: `mission-${m0.classId}-${m0.date}`, title: "📄 미션지 요청", body: `${m0.className} — 누르면 바로 열려요`, short: "미션지!" }
      : a0
        ? { key: `adhoc-${a0.id}`, title: "🙋 SR 자리 요청", body: `${a0.name} · ${fmtTime(a0.start)} — 누르면 바로 열려요`, short: "SR 자리 요청!" }
        : null;
  useDesktopAlert(alert, () => {
    // 알림창을 누르면 접어 둔 팝업도 연다
    if (current) setFolded((m) => ({ ...m, [current.key]: false }));
  });

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
