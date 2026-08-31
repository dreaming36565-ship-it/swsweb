"use client";

// 결석관리 — 날짜별 출결 이벤트와 단계, 학생별 상태·사유·도착예정시간.
// 오른쪽에서 아직 열리지 않은 수업을 "지금 열기" 로 즉시 시작할 수 있다.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { dateKey, rangeLabel } from "@/lib/time";
import {
  STAGE_LABEL,
  STATUS_LABEL,
  type AttendanceEvent,
  type AttStatus,
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
  unchecked: number;
};

type Payload = {
  date: string;
  events: AttendanceEvent[];
  notOpened: TimetableSession[];
  summary: Summary;
};

const statusChip = (status: AttStatus) => {
  if (status === "PRESENT") return "border-present bg-present-soft text-present";
  if (status === "ABSENT") return "border-alert bg-alert-soft text-alert";
  if (status === "LATE") return "border-late bg-late-soft text-late";
  return "border-line bg-white text-muted";
};

const stageChip = (stage: Stage) => {
  if (stage === "DONE") return "border-line bg-navy-50 text-muted";
  if (stage === "DESK_PENDING") return "border-late bg-late-soft text-late";
  if (stage === "TEACHER_CONFIRM") return "border-present bg-present-soft text-present";
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

  const openNow = async (sessionId: number) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/attendance/trigger", { sessionId, date });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const canTrigger = user.role === "ADMIN" || user.role === "TEACHER";
  const summary = data?.summary;

  return (
    <div className="w-full space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-muted">날짜</span>
          <input
            type="date"
            className="field w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          {summary ? (
            <div className="flex flex-wrap gap-x-4 text-sm">
              <span className="text-present">출석 {summary.present}</span>
              <span className="text-alert">결석 {summary.absent}</span>
              <span className="text-late">지각 {summary.late}</span>
              <span className="text-muted">미체크 {summary.unchecked}</span>
            </div>
          ) : null}
          <select
            className="field w-36"
            value={dept}
            onChange={(e) => setDept(e.target.value as "ALL" | Department)}
          >
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
            <div className="card px-5 py-8 text-center text-sm text-muted">
              이 날짜에 열린 출결이 없습니다.
            </div>
          ) : (
            (data?.events ?? []).map((e) => (
              <article key={e.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                  <div>
                    <span className="text-base font-bold text-ink">{e.className}</span>
                    <span className="ml-2 text-sm text-muted">
                      {rangeLabel(e.startMin, e.endMin)}
                      {e.teacherName ? ` · ${e.teacherName} 선생님` : ""}
                      {e.roomName ? ` · ${e.roomName}` : ""}
                    </span>
                  </div>
                  <span
                    className={`rounded-md border px-2.5 py-1 text-xs font-bold ${stageChip(e.stage)}`}
                  >
                    {STAGE_LABEL[e.stage]}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-navy-50 text-left text-xs font-semibold text-muted">
                      <th className="px-5 py-2">이름</th>
                      <th className="w-24 px-4 py-2 text-center">상태</th>
                      <th className="px-4 py-2">사유</th>
                      <th className="w-32 px-4 py-2">도착예정시간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.records.map((r) => (
                      <tr key={r.id} className="border-b border-line last:border-b-0">
                        <td className="px-5 py-2 font-semibold text-ink">{r.studentName}</td>
                        <td className="px-4 py-2 text-center">
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${statusChip(r.status)}`}
                          >
                            {STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-ink">{r.absentReason || r.lateReason || "—"}</td>
                        <td className="px-4 py-2 text-ink">{r.eta || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            ))
          )}
        </section>

        <aside className="card w-[300px] shrink-0 self-start p-5">
          <h2 className="text-base font-bold text-ink">아직 열리지 않은 수업</h2>
          <p className="mt-1 text-xs text-muted">
            수업 시작 2분 뒤 자동으로 열립니다. 놓쳤다면 지금 열 수 있습니다.
          </p>
          <div className="mt-4 space-y-2">
            {(data?.notOpened ?? []).length === 0 ? (
              <p className="text-sm text-muted">모두 열렸습니다.</p>
            ) : (
              (data?.notOpened ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{s.className}</div>
                    <div className="truncate text-xs text-muted">
                      {rangeLabel(s.startMin, s.endMin)}
                      {s.teacherName ? ` · ${s.teacherName}` : ""}
                    </div>
                  </div>
                  {canTrigger ? (
                    <button
                      type="button"
                      className="btn px-2.5 py-1 text-xs"
                      onClick={() => void openNow(s.id)}
                      disabled={busy}
                    >
                      지금 열기
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
