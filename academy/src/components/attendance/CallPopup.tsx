"use client";

// ② 출결전화 — 데스크 전용. 1차 출석체크에서 체크되지 않은 학생에게 순서대로 연락한다.
//   ① 학생 전화 → (부재중) ② 학부모 전화 → (부재중) ③ 어머니께 부재중 카톡
//   통화되면 지각(사유 + 도착예정시간) 또는 결석(사유).
// 누를 때마다 서버에 저장되고(통화 시각 자동 기록), 같은 버튼을 다시 누르면 취소된다.
// 남은 인원 = 아직 아무와도 연락이 닿지 않은 학생. 0명이 되고 사유가 다 채워져야 저장할 수 있다.

import { useEffect, useMemo, useRef, useState } from "react";
import PopupFrame, { WhoBadge } from "./PopupFrame";
import TimeSelect from "../TimeSelect";
import { useAlarmLoop } from "../useAlarmLoop";
import { apiPost, errorMessage } from "@/lib/http";
import { callStateOf, isReached, isRemaining, needsInfo, normalizeCall } from "@/lib/attendance";
import { fmtTime } from "@/lib/time";
import type { AttendanceGroup, AttendanceRecord, CallState } from "@/lib/types";

type Row = { record: AttendanceRecord; className: string; teacherName: string | null };

export default function CallPopup({
  group,
  muted,
  onToggleMute,
  onDone,
}: {
  group: AttendanceGroup;
  muted: boolean;
  onToggleMute: () => void;
  onDone: () => void;
}) {
  const rows: Row[] = useMemo(
    () =>
      group.events.flatMap((e) =>
        e.records
          .filter((r) => r.status === "UNCHECKED")
          .map((record) => ({ record, className: e.className, teacherName: e.teacherName })),
      ),
    [group],
  );

  // 화면에 보이는 상태 — 서버 기록으로 시작하고, 누를 때마다 바로 바꾼 뒤 서버에 저장한다
  const [states, setStates] = useState<Record<number, CallState>>({});
  const [records, setRecords] = useState<Record<number, AttendanceRecord>>({});
  const dirty = useRef(new Set<number>());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useAlarmLoop(true, muted);

  // 누르는 즉시 최신 값을 담아 두는 사본 — 빠르게 연달아 눌러도 앞 클릭이 사라지지 않게
  const live = useRef<Record<number, CallState>>({});

  // 새로 들어온 학생만 서버 상태로 채운다 (입력 중인 사유가 폴링에 덮이지 않게)
  useEffect(() => {
    for (const { record } of rows) if (!live.current[record.id]) live.current[record.id] = callStateOf(record);
    setStates({ ...live.current });
    setRecords((cur) => {
      const next = { ...cur };
      for (const { record } of rows) if (!next[record.id]) next[record.id] = record;
      return next;
    });
  }, [rows]);

  const stateOf = (id: number) =>
    live.current[id] ?? states[id] ?? callStateOf(rows.find((r) => r.record.id === id)!.record);

  const save = async (id: number, state: CallState) => {
    try {
      const res = await apiPost<{ record: AttendanceRecord }>("/api/attendance/submit", {
        step: "CALL",
        recordId: id,
        state,
      });
      dirty.current.delete(id);
      setRecords((r) => ({ ...r, [id]: res.record }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  /** 상태를 바꾸고 바로 저장. 순서 규칙(앞 단계 취소 → 뒤 단계도 취소)은 normalizeCall 이 맞춘다. */
  const change = (id: number, patch: Partial<CallState>, persist = true) => {
    setError(null);
    const next = normalizeCall({ ...stateOf(id), ...patch });
    live.current[id] = next;
    setStates({ ...live.current });
    if (persist) void save(id, next);
    else dirty.current.add(id);
  };

  /** 같은 값을 다시 누르면 취소 */
  const toggle = <K extends "studentCall" | "parentCall" | "callResult">(id: number, key: K, value: CallState[K]) =>
    change(id, { [key]: stateOf(id)[key] === value ? null : value } as Partial<CallState>);

  const list = rows.map((r) => ({ ...r, state: stateOf(r.record.id) }));
  const remaining = list.filter((r) => isRemaining(r.state)).length;
  const missingInfo = list.filter((r) => needsInfo(r.state)).length;

  const complete = async () => {
    setError(null);
    setBusy(true);
    try {
      // 입력 중이던 사유가 있으면 먼저 저장
      for (const id of [...dirty.current]) await save(id, stateOf(id));
      await apiPost("/api/attendance/submit", { step: "CALL_DONE", eventIds: group.events.map((e) => e.id) });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const label = remaining > 0 ? `남은 인원 ${remaining}명` : missingInfo > 0 ? `사유 입력 필요 ${missingInfo}명` : "저장 완료";

  return (
    <PopupFrame
      heading="출결전화 돌려주세요."
      subtitle={
        <>
          <WhoBadge>데스크</WhoBadge>
          {fmtTime(group.triggerMin)} 출결 · 전화할 학생 {list.length}명 ·{" "}
          <b className="text-late">남은 인원 {remaining}명</b>
        </>
      }
      muted={muted}
      onToggleMute={onToggleMute}
      error={error}
      note="체크되지 않은 친구들 전화 돌려주시고, 지각사유와 도착예정시간 남겨주세요."
      footer={
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void complete()}
          disabled={busy || remaining > 0 || missingInfo > 0}
        >
          {busy ? "저장 중…" : label}
        </button>
      }
    >
      <div className="space-y-2.5">
        {list.map(({ record, className, teacherName, state }) => {
          const id = record.id;
          const saved = records[id] ?? record;
          const reached = isReached(state);
          const parentOpen = state.studentCall === "MISS";
          const kakaoOpen = parentOpen && state.parentCall === "MISS";
          const need = needsInfo(state);
          const active = state.arrived
            ? null
            : state.studentCall === null
              ? "student"
              : parentOpen && state.parentCall === null
                ? "parent"
                : kakaoOpen && !state.kakao
                  ? "kakao"
                  : null;
          return (
            <div
              key={id}
              className={`rounded-xl border border-line px-4 py-3 ${isRemaining(state) ? "bg-white" : "bg-navy-50"}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-[15px] font-bold text-ink">{record.studentName}</span>
                <span className="text-xs text-muted">
                  {className}
                  {teacherName ? ` · ${teacherName} 선생님` : ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <Btn on={state.arrived} tone="present" onClick={() => change(id, { arrived: !state.arrived })}>
                    {state.arrived ? "도착 ✓" : "도착"}
                  </Btn>
                  <StatusChip state={state} />
                </span>
              </div>

              {state.arrived ? null : (
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <Rung title="① 학생 전화" active={active === "student"} time={saved.studentCallAt}>
                    <Btn on={state.studentCall === "OK"} tone="present" onClick={() => toggle(id, "studentCall", "OK")}>
                      통화됨
                    </Btn>
                    <Btn on={state.studentCall === "MISS"} tone="muted" onClick={() => toggle(id, "studentCall", "MISS")}>
                      부재중
                    </Btn>
                  </Rung>
                  <Rung title="② 학부모 전화" active={active === "parent"} time={saved.parentCallAt}>
                    <Btn
                      on={state.parentCall === "OK"}
                      tone="present"
                      disabled={!parentOpen}
                      onClick={() => toggle(id, "parentCall", "OK")}
                    >
                      통화됨
                    </Btn>
                    <Btn
                      on={state.parentCall === "MISS"}
                      tone="muted"
                      disabled={!parentOpen}
                      onClick={() => toggle(id, "parentCall", "MISS")}
                    >
                      부재중
                    </Btn>
                  </Rung>
                  <Rung title="③ 어머니께 부재중 카톡" active={active === "kakao"} time={saved.kakaoAt}>
                    <Btn on={state.kakao} tone="muted" disabled={!kakaoOpen} onClick={() => change(id, { kakao: !state.kakao })}>
                      카톡 남김
                    </Btn>
                  </Rung>
                </div>
              )}

              {!state.arrived && reached ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-navy-50 p-2.5">
                  <Btn on={state.callResult === "LATE"} tone="late" onClick={() => toggle(id, "callResult", "LATE")}>
                    지각
                  </Btn>
                  <Btn on={state.callResult === "ABSENT"} tone="alert" onClick={() => toggle(id, "callResult", "ABSENT")}>
                    결석
                  </Btn>
                  {state.callResult ? (
                    <input
                      className={`field min-w-[200px] flex-1 ${state.reason.trim() ? "" : "border-late"}`}
                      placeholder={state.callResult === "LATE" ? "지각 사유 예) 학교 행사" : "결석 사유 예) 병결"}
                      value={state.reason}
                      onChange={(e) => change(id, { reason: e.target.value }, false)}
                      onBlur={() => dirty.current.has(id) && void save(id, stateOf(id))}
                    />
                  ) : null}
                  {state.callResult === "LATE" ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-muted">도착 예정</span>
                      <TimeSelect
                        className="w-48"
                        value={state.etaMin}
                        allowEmpty
                        disabled={state.etaUnknown}
                        onChange={(v) => change(id, { etaMin: v, etaUnknown: false })}
                      />
                      <Btn
                        on={state.etaUnknown}
                        tone="late"
                        onClick={() => change(id, { etaUnknown: !state.etaUnknown })}
                      >
                        모름
                      </Btn>
                    </div>
                  ) : null}
                  {need ? (
                    <span className="text-xs font-semibold text-late">
                      {state.callResult ? "정보를 채워 주세요" : "지각 / 결석을 골라 주세요"}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </PopupFrame>
  );
}

const TONE = {
  present: "border-present bg-present text-white",
  muted: "border-muted bg-muted text-white",
  late: "border-late bg-late text-white",
  alert: "border-alert bg-alert text-white",
} as const;

/** 눌린 상태가 보이는 토글 버튼 — 다시 누르면 취소 */
function Btn({
  on,
  tone,
  disabled = false,
  onClick,
  children,
}: {
  on: boolean;
  tone: keyof typeof TONE;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn px-2.5 py-1 text-xs ${on ? `${TONE[tone]} hover:opacity-90` : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={on ? "다시 누르면 취소됩니다" : undefined}
    >
      {children}
    </button>
  );
}

function Rung({
  title,
  active,
  time,
  children,
}: {
  title: string;
  active: boolean;
  time: number | null;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${active ? "border-navy-400 ring-2 ring-navy-100" : "border-line"}`}>
      <div className={`mb-1.5 text-xs font-bold ${active ? "text-navy-800" : "text-muted"}`}>{title}</div>
      <div className="flex items-center gap-1.5">
        {children}
        {time !== null ? <span className="ml-auto text-[11px] tabular-nums text-muted">{fmtTime(time)}</span> : null}
      </div>
    </div>
  );
}

function StatusChip({ state }: { state: CallState }) {
  const base = "rounded-full border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap";
  if (state.arrived) return <span className={`${base} border-present bg-present-soft text-present`}>도착 · 출석</span>;
  if (isReached(state) && state.callResult === "LATE")
    return (
      <span className={`${base} border-late bg-late-soft text-late`}>
        지각{state.etaUnknown ? " · 도착시간 모름" : state.etaMin !== null ? ` · ${fmtTime(state.etaMin)}` : ""}
      </span>
    );
  if (isReached(state) && state.callResult === "ABSENT")
    return <span className={`${base} border-alert bg-alert-soft text-alert`}>결석</span>;
  if (isReached(state)) return <span className={`${base} border-late bg-white text-late`}>통화됨 · 결과 입력</span>;
  if (state.kakao) return <span className={`${base} border-navy-400 bg-navy-100 text-navy-700`}>연락 안 됨 · 카톡 남김</span>;
  return <span className={`${base} border-line bg-white text-muted`}>남은 인원</span>;
}
