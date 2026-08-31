"use client";

// SR 관리 — 24석(A~D열 × 6자리) 자리배치도.
// 학생을 고르면 "이용시간 전체가 비어 있는 좌석"만 핑크로 뜬다.

import { useCallback, useEffect, useMemo, useState } from "react";
import TimeSelect from "../TimeSelect";
import { useConfirm } from "../ConfirmDialog";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { classColor } from "@/lib/colors";
import { SEAT_COLS, SEAT_ROWS, occupantAt, type SeatUse } from "@/lib/sr";
import { DAY_END, DAY_LABELS, DAY_START, STEP, minutesOfDay, rangeLabel } from "@/lib/time";
import type { Department, SessionUser, SrAssignment, TimetableSession } from "@/lib/types";

type Payload = { day: number; assignments: SrAssignment[]; sessions: TimetableSession[] };

export default function SrClient({ user }: { user: SessionUser }) {
  const confirm = useConfirm();
  const today = new Date();

  const [day, setDay] = useState(today.getDay());
  const [dept, setDept] = useState<"ALL" | Department>("ALL");
  // 기준 시각 기본값은 현재 시각(10분 단위). 그리드 범위를 벗어나면 06:00~23:50 안으로 맞춘다.
  const [atMin, setAtMin] = useState(() =>
    Math.min(DAY_END, Math.max(DAY_START, Math.floor(minutesOfDay(today) / STEP) * STEP)),
  );
  const [data, setData] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [movable, setMovable] = useState<string[]>([]);
  const [targetSeat, setTargetSeat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await apiGet<Payload>(`/api/sr?day=${day}&dept=${dept}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [day, dept]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignments = useMemo(() => data?.assignments ?? [], [data]);

  const seatUses: SeatUse[] = useMemo(
    () =>
      assignments.map((a) => ({
        id: a.id,
        studentId: a.studentId,
        seat: a.seat,
        startMin: a.startMin,
        endMin: a.endMin,
      })),
    [assignments],
  );

  const selected = assignments.find((a) => a.id === selectedId) ?? null;

  const select = async (a: SrAssignment) => {
    setSelectedId(a.id);
    setTargetSeat(null);
    setError(null);
    try {
      const res = await apiGet<{ seats: string[] }>(`/api/sr/options?assignmentId=${a.id}`);
      setMovable(res.seats);
    } catch (e) {
      setMovable([]);
      setError(errorMessage(e));
    }
  };

  const clearSelection = () => {
    setSelectedId(null);
    setMovable([]);
    setTargetSeat(null);
  };

  const applyMove = async () => {
    if (!selected || !targetSeat) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/sr/move", { assignmentId: selected.id, seat: targetSeat });
      clearSelection();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resetDay = async () => {
    const yes = await confirm({
      title: "자동 배정으로 되돌릴까요?",
      message: `${DAY_LABELS[day]}요일의 수동 이동이 모두 사라지고 자동 배정으로 다시 계산됩니다.`,
      confirmText: "되돌리기",
    });
    if (!yes) return;
    setBusy(true);
    try {
      await apiPost("/api/sr/reset", { day });
      clearSelection();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const seatInfo = (seat: string) => {
    const occupant = occupantAt(seat, atMin, seatUses);
    const assignment = occupant ? assignments.find((a) => a.id === occupant.id) ?? null : null;
    const isSelf = selected !== null && selected.seat === seat;
    const isMovable = movable.includes(seat);
    return { assignment, isSelf, isMovable };
  };

  return (
    <div className="w-full space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-1">
          {DAY_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setDay(i);
                clearSelection();
              }}
              className={`h-9 w-11 rounded-lg text-sm font-bold transition-colors ${
                day === i ? "bg-navy-800 text-white" : "text-muted hover:bg-navy-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted">기준 시각</span>
            <TimeSelect value={atMin} onChange={(v) => setAtMin(v ?? 0)} className="w-28" />
          </div>
          <select
            className="field w-36"
            value={dept}
            onChange={(e) => {
              setDept(e.target.value as "ALL" | Department);
              clearSelection();
            }}
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
        {/* 자리배치도 */}
        <section className="card min-w-0 flex-1 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">SR룸 자리배치 (24석)</h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <Legend className="border-navy-800 bg-navy-800" label="선택 학생" />
              <Legend className="border-srpink bg-srpink-soft" label="이동 가능" />
              <Legend className="border-line bg-white" label="사용 중" />
              <Legend className="border-line bg-navy-100" label="이동 불가" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-4">
            {SEAT_COLS.map((col) => (
              <div key={col}>
                <div className="mb-2 text-center text-sm font-bold text-navy-700">{col}열</div>
                <div className="space-y-2">
                  {Array.from({ length: SEAT_ROWS }, (_, i) => {
                    const seat = `${col}${i + 1}`;
                    const { assignment, isSelf, isMovable } = seatInfo(seat);
                    const color = assignment ? classColor(assignment.classId) : null;

                    let cls = "border-line bg-navy-100 text-muted";
                    let style: React.CSSProperties = {};
                    if (isSelf) {
                      cls = "border-navy-900 bg-navy-800 text-white";
                    } else if (selected && isMovable) {
                      cls = "border-srpink bg-srpink-soft text-srpink";
                    } else if (assignment) {
                      cls = "border-line bg-white";
                      style = color ? { borderColor: color.border, color: color.text } : {};
                    } else if (!selected) {
                      cls = "border-line bg-white text-muted";
                    }

                    const clickable = Boolean(assignment) || (selected !== null && isMovable);

                    return (
                      <button
                        key={seat}
                        type="button"
                        disabled={!clickable}
                        onClick={() => {
                          if (selected && isMovable) setTargetSeat(seat);
                          else if (assignment) void select(assignment);
                        }}
                        className={`w-full rounded-lg border px-2 py-2 text-left transition-colors ${cls} ${
                          targetSeat === seat ? "ring-2 ring-srpink" : ""
                        } ${clickable ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
                        style={style}
                      >
                        <div className="text-[11px] font-bold opacity-70">{seat}</div>
                        <div className="truncate text-sm font-semibold">
                          {assignment ? assignment.studentName : " "}
                        </div>
                        <div className="truncate text-[11px] opacity-70">
                          {assignment ? assignment.className : " "}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 정보 패널 */}
        <aside className="card w-[300px] shrink-0 self-start p-5">
          <h2 className="text-base font-bold text-ink">학생 정보</h2>
          {!selected ? (
            <p className="mt-3 text-sm text-muted">
              자리배치도에서 학생을 클릭하면 이동 가능한 좌석이 핑크색으로 표시됩니다.
            </p>
          ) : (
            <div className="mt-4 space-y-3 text-sm">
              <Row label="학생 이름" value={selected.studentName} />
              <Row label="현재 좌석" value={selected.seat} />
              <Row label="이용 시간" value={rangeLabel(selected.startMin, selected.endMin)} />
              <Row label="소속 반" value={selected.className} />
              <Row
                label="배정 방식"
                value={selected.isManual === 1 ? "수동 이동" : "자동 배정"}
              />
              <div>
                <div className="label">이동 가능한 좌석</div>
                {movable.length === 0 ? (
                  <p className="text-sm text-muted">이동 가능한 좌석이 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {movable.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTargetSeat(s)}
                        className={`rounded-md border px-2 py-1 text-xs font-bold ${
                          targetSeat === s
                            ? "border-srpink bg-srpink text-white"
                            : "border-srpink bg-srpink-soft text-srpink"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-5 space-y-2">
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!selected || !targetSeat || busy}
              onClick={() => void applyMove()}
            >
              {targetSeat ? `${targetSeat} 로 자리 이동 적용` : "자리 이동 적용"}
            </button>
            <button type="button" className="btn w-full" onClick={() => void resetDay()} disabled={busy}>
              자동 배정으로 되돌리기
            </button>
            {selected ? (
              <button type="button" className="btn btn-ghost w-full" onClick={clearSelection}>
                선택 해제
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded border ${className}`} />
      {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}
