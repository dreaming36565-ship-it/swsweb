"use client";

// 결석관리 — 날짜별 출결과 학생별 상태·사유·연락 기록.
// "연락 안 됨" 학생이 나중에 오면 데스크가 여기서 [도착] → 지각 명단으로 옮긴다 (선생님께 따로 알림 없음).
// 오른쪽에서 아직 열리지 않은 출결을 시각별로 "지금 열기" 할 수 있다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { reasonText, statusChipClass, statusText, contactLog } from "./ResultTable";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { canMarkAbsent, triggerOf } from "@/lib/attendance";
import { dateKey, fmtTime, minutesOfDay, rangeLabel } from "@/lib/time";
import {
  STAGE_LABEL,
  type AttendanceEvent,
  type AttendanceRecord,
  type Department,
  type SessionUser,
  type Stage,
  type TimetableSession,
} from "@/lib/types";

type Summary = {
  total: number;
  byStage: Record<Stage, number>;
  present: number;
  absent: number;
  late: number;
  noContact: number;
  unchecked: number;
};

type Payload = {
  date: string;
  events: AttendanceEvent[];
  notOpened: TimetableSession[];
  summary: Summary;
};

const stageChip = (stage: Stage) => {
  if (stage === "DONE") return "border-line bg-navy-50 text-muted";
  if (stage === "CALL") return "border-late bg-late-soft text-late";
  return "border-navy-300 bg-navy-50 text-navy-800";
};

export default function AttendanceClient({ user }: { user: SessionUser }) {
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [dept, setDept] = useState<"ALL" | Department>("ALL");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await apiGet<Payload>(`/api/attendance/list?date=${date}&dept=${dept}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [date, dept]);

  // 출결은 팝업에서 다른 사람이 처리하는 사이에도 바뀐다. 화면을 살아 있게 유지한다.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // 아직 안 열린 수업을 "출결 시작 시각" 별로 묶는다 — 같은 시각 반들은 팝업 하나로 열린다
  const slots = useMemo(() => {
    const map = new Map<string, { triggerMin: number; desk: boolean; sessions: TimetableSession[] }>();
    for (const s of data?.notOpened ?? []) {
      const t = triggerOf(s);
      const key = `${t.triggerMin}-${t.checker}`;
      const g = map.get(key) ?? { triggerMin: t.triggerMin, desk: t.checker === "DESK", sessions: [] };
      g.sessions.push(s);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => a.triggerMin - b.triggerMin);
  }, [data]);

  const canArrive = user.role === "ADMIN" || user.role === "DESK";

  // 실제 시간이 되어야 열 수 있다 — 오늘은 출결 시작 시각이 지나야, 앞날은 불가 (5초마다 다시 그려져 시간이 되면 풀린다)
  const today = dateKey(new Date());
  const openableAt = (triggerMin: number): string | null => {
    if (date > today) return "아직 오지 않은 날짜";
    if (date === today && minutesOfDay(new Date()) < triggerMin) return `${fmtTime(triggerMin)}부터`;
    return null;
  };
  const summary = data?.summary;

  return (
    <div className="w-full space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-muted">날짜</span>
          <input type="date" className="field w-44" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          {summary ? (
            <div className="flex flex-wrap gap-x-4 text-sm">
              <span className="text-present">출석 {summary.present}</span>
              <span className="text-late">지각 {summary.late}</span>
              <span className="text-alert">결석 {summary.absent}</span>
              <span className="text-navy-700">연락 안 됨 {summary.noContact}</span>
              <span className="text-muted">미체크 {summary.unchecked}</span>
            </div>
          ) : null}
          <select className="field w-36" value={dept} onChange={(e) => setDept(e.target.value as "ALL" | Department)}>
            <option value="ALL">전체 부서</option>
            <option value="ELEM">초중등부</option>
            <option value="HIGH">고등부</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-alert bg-alert-soft px-5 py-3 text-sm font-semibold text-alert">
          {error}
        </div>
      ) : null}

      <div className="flex w-full gap-4">
        <section className="min-w-0 flex-1 space-y-4">
          {(data?.events ?? []).length === 0 ? (
            <div className="card px-5 py-8 text-center text-sm text-muted">이 날짜에 열린 출결이 없습니다.</div>
          ) : (
            (data?.events ?? []).map((e) => (
              <article key={e.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                  <div>
                    <span className="text-base font-bold text-ink">{e.className}</span>
                    <span className="ml-2 text-sm text-muted">
                      {fmtTime(e.triggerMin)} {e.checker === "DESK" ? "알파" : "수업"} 시작 · 수업{" "}
                      {rangeLabel(e.startMin, e.endMin)}
                      {e.teacherName ? ` · ${e.teacherName} 선생님` : ""}
                    </span>
                  </div>
                  <span className={`rounded-md border px-2.5 py-1 text-xs font-bold ${stageChip(e.stage)}`}>
                    {STAGE_LABEL[e.stage]}
                    {e.stage === "CHECK" ? ` (${e.checker === "DESK" ? "데스크" : "담당 선생님"})` : ""}
                    {e.stage === "CALL" ? " (데스크)" : ""}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-navy-50 text-left text-xs font-semibold text-muted">
                      <th className="px-5 py-2">이름</th>
                      <th className="px-4 py-2">상태</th>
                      <th className="px-4 py-2">사유</th>
                      <th className="px-4 py-2">연락 기록</th>
                      {canArrive ? <th className="px-4 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {e.records.map((r) => (
                      <tr key={r.id} className="border-b border-line last:border-b-0">
                        <td className="whitespace-nowrap px-5 py-2 font-semibold text-ink">{r.studentName}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${statusChipClass(r.status)}`}
                          >
                            {statusText(r)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-ink">{r.status === "PRESENT" || r.status === "UNCHECKED" ? "—" : reasonText(r)}</td>
                        <td className="px-4 py-2 text-xs text-muted">{contactLog(r).join(" · ") || "—"}</td>
                        {canArrive ? (
                          <td className="whitespace-nowrap px-4 py-2 text-right">
                            <RecordActions
                              record={r}
                              disabled={busy}
                              send={(body) => void run(() => apiPost("/api/attendance/submit", body))}
                            />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            ))
          )}
        </section>

        <aside className="card w-[300px] shrink-0 self-start p-5">
          <h2 className="text-base font-bold text-ink">아직 열리지 않은 출결</h2>
          <p className="mt-1 text-xs text-muted">
            수업·알파 중 먼저 시작하는 시각 2분 뒤 자동으로 열립니다. 시작 시각이 지났는데 놓쳤다면 지금 열 수
            있습니다.
          </p>
          <div className="mt-4 space-y-2">
            {slots.length === 0 ? (
              <p className="text-sm text-muted">모두 열렸습니다.</p>
            ) : (
              slots.map((g) => (
                <div
                  key={`${g.triggerMin}-${g.desk}`}
                  className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      {fmtTime(g.triggerMin)} {g.desk ? "알파" : "수업"} 시작
                    </div>
                    <div className="truncate text-xs text-muted">
                      {g.sessions.map((s) => s.className).join(", ")} · {g.desk ? "데스크" : "담당 선생님"} 체크
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn shrink-0 px-2.5 py-1 text-xs"
                    onClick={() =>
                      void run(() =>
                        apiPost("/api/attendance/trigger", { sessionIds: g.sessions.map((s) => s.id), date }),
                      )
                    }
                    disabled={busy || openableAt(g.triggerMin) !== null}
                    title={openableAt(g.triggerMin) ? "출결 시작 시각이 되어야 열 수 있습니다" : undefined}
                  >
                    {openableAt(g.triggerMin) ?? "지금 열기"}
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * 데스크가 나중에 처리하는 버튼들 (알림은 보내지 않는다)
 * - 연락 안 됨 / 도착시간 모름 지각 → [도착] (지각으로, 도착 시각 기록) 또는 [결석으로 변경] (사유 필수)
 * - 처리한 뒤에는 [도착 취소] / [되돌리기] 로 원래대로
 */
function RecordActions({
  record,
  disabled,
  send,
}: {
  record: AttendanceRecord;
  disabled: boolean;
  send: (body: Record<string, unknown>) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const small = "btn px-2.5 py-1 text-xs";

  const arrivedLater = record.lateArrival === 1 || (record.status === "LATE" && record.etaUnknown === 1 && record.arrivedAt !== null);
  if (arrivedLater) {
    return (
      <button type="button" className={`${small} text-muted`} disabled={disabled} onClick={() => send({ step: "ARRIVE", recordId: record.id })} title="도착 처리를 취소합니다">
        도착 취소
      </button>
    );
  }
  if (record.status === "ABSENT" && record.absentFrom) {
    return (
      <button type="button" className={`${small} text-muted`} disabled={disabled} onClick={() => send({ step: "UNDO_ABSENT", recordId: record.id })} title="결석으로 바꾸기 전 상태로 되돌립니다">
        되돌리기
      </button>
    );
  }
  if (!canMarkAbsent(record)) return null;

  if (asking) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <input
          className="field w-36 py-1 text-xs"
          placeholder="결석 사유 (필수)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <button
          type="button"
          className={`${small} border-alert bg-alert text-white`}
          disabled={disabled || !reason.trim()}
          onClick={() => {
            send({ step: "TO_ABSENT", recordId: record.id, reason });
            setAsking(false);
            setReason("");
          }}
        >
          결석
        </button>
        <button type="button" className={`${small} btn-ghost`} onClick={() => setAsking(false)}>
          취소
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button type="button" className={`${small} btn-primary`} disabled={disabled} onClick={() => send({ step: "ARRIVE", recordId: record.id })}>
        도착
      </button>
      <button type="button" className={`${small} text-alert`} disabled={disabled} onClick={() => setAsking(true)}>
        결석으로 변경
      </button>
    </div>
  );
}
