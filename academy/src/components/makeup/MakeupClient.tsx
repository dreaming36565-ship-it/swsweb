"use client";

// 보강 관리 — 횟수로 수강료를 받기 때문에 "결석 1건마다 보강이 이루어졌는지" 를 추적한다.
// 왼쪽: 보강이 필요한 결석 + 보강 일정 / 오른쪽: 보강 등록 폼.
// 등록한 보강은 담당 선생님의 대시보드 일정과 시간표에도 함께 표시된다.

import { useCallback, useEffect, useMemo, useState } from "react";
import Combobox, { type ComboValue } from "../Combobox";
import TimeSelect from "../TimeSelect";
import { useConfirm } from "../ConfirmDialog";
import { IconCheck, IconRefresh, IconTrash } from "../Icons";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { dateKey, formatDateShort, rangeLabel } from "@/lib/time";
import {
  MAKEUP_STATUS_LABEL,
  type ClassRow,
  type Department,
  type Makeup,
  type MakeupStatus,
  type PendingAbsence,
  type Room,
  type SessionUser,
  type StaffUser,
  type Student,
} from "@/lib/types";

type Summary = { absences: number; notScheduled: number; planned: number; done: number };

type Payload = {
  makeups: Makeup[];
  absences: PendingAbsence[];
  summary: Summary;
  students: Student[];
  classes: ClassRow[];
  rooms: Room[];
  teachers: StaffUser[];
};

const emptyForm = () => ({
  student: { id: null, name: "" } as ComboValue,
  classId: null as number | null,
  absentDate: null as string | null,
  date: dateKey(new Date()),
  startMin: null as number | null,
  endMin: null as number | null,
  roomId: null as number | null,
  teacherId: null as number | null,
  note: "",
});

const statusChip = (status: MakeupStatus) => {
  if (status === "DONE") return "border-present bg-present-soft text-present";
  if (status === "CANCELED") return "border-line bg-navy-50 text-muted";
  return "border-late bg-late-soft text-late";
};

export default function MakeupClient({ user }: { user: SessionUser }) {
  const confirm = useConfirm();
  const canDelete = user.role === "ADMIN";

  const [dept, setDept] = useState<"ALL" | Department>("ALL");
  const [onlyUnfinished, setOnlyUnfinished] = useState(true);
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(
        await apiGet<Payload>(`/api/makeups?dept=${dept}&unfinished=${onlyUnfinished ? 1 : 0}`),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [dept, onlyUnfinished]);

  useEffect(() => {
    void load();
  }, [load]);

  const students = data?.students ?? [];
  const rooms = data?.rooms ?? [];
  const teachers = data?.teachers ?? [];
  const summary = data?.summary;

  const studentOptions = useMemo(
    () => students.map((s) => ({ id: s.id, label: s.name, hint: s.classNames.join(" · ") || undefined })),
    [students],
  );

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** 결석 행의 "보강 잡기" — 폼을 그 학생·결석일로 채워준다 */
  const fillFrom = (a: PendingAbsence) => {
    setError(null);
    setForm((f) => ({
      ...f,
      student: { id: a.studentId, name: a.studentName },
      classId: a.classId,
      absentDate: a.date,
      teacherId: a.teacherId,
      note: a.reason ? `결석 사유: ${a.reason}` : "",
    }));
  };

  const create = () =>
    run(async () => {
      await apiPost("/api/makeups", {
        studentId: form.student.id,
        classId: form.classId,
        absentDate: form.absentDate,
        date: form.date,
        startMin: form.startMin,
        endMin: form.endMin,
        roomId: form.roomId,
        teacherId: form.teacherId,
        note: form.note,
      });
      setForm(emptyForm());
    });

  const setStatus = (m: Makeup, status: MakeupStatus) =>
    run(() => apiPatch("/api/makeups", { id: m.id, status }));

  const remove = async (m: Makeup) => {
    const yes = await confirm({
      title: "보강을 삭제할까요?",
      message: `${m.studentName} · ${formatDateShort(m.date)} ${rangeLabel(m.startMin, m.endMin)}`,
      confirmText: "삭제",
      danger: true,
    });
    if (yes) void run(() => apiDelete("/api/makeups", { id: m.id }));
  };

  return (
    <div className="w-full space-y-4">
      {/* 요약 */}
      <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex flex-wrap gap-3">
          {[
            { label: "결석 건수", value: summary?.absences ?? 0, tone: "text-ink" },
            { label: "보강 미등록", value: summary?.notScheduled ?? 0, tone: "text-alert" },
            { label: "보강 예정", value: summary?.planned ?? 0, tone: "text-late" },
            { label: "보강 완료", value: summary?.done ?? 0, tone: "text-present" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-line px-4 py-2">
              <div className="text-xs text-muted">{s.label}</div>
              <div className={`text-2xl font-bold tabular-nums ${s.tone}`}>{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-navy-800)]"
              checked={onlyUnfinished}
              onChange={(e) => setOnlyUnfinished(e.target.checked)}
            />
            아직 보강 안 한 것만
          </label>
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
        <div className="min-w-0 flex-1 space-y-4">
          {/* 보강이 필요한 결석 */}
          <section className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3">
              <h2 className="text-base font-bold text-ink">보강이 필요한 결석</h2>
              <p className="mt-0.5 text-xs text-muted">
                결석관리에서 &quot;결석&quot;으로 처리된 건이 여기 모입니다.
              </p>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-navy-50 text-left text-xs font-semibold text-muted">
                    <th className="px-5 py-2.5">결석일</th>
                    <th className="px-4 py-2.5">학생</th>
                    <th className="px-4 py-2.5">반</th>
                    <th className="px-4 py-2.5">담당</th>
                    <th className="px-4 py-2.5">결석 사유</th>
                    <th className="w-40 px-4 py-2.5">보강</th>
                    <th className="w-24 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.absences ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-muted">
                        {onlyUnfinished ? "보강이 남은 결석이 없습니다." : "결석 기록이 없습니다."}
                      </td>
                    </tr>
                  ) : (
                    (data?.absences ?? []).map((a) => (
                      <tr key={`${a.date}-${a.studentId}`} className="border-b border-line last:border-b-0">
                        <td className="px-5 py-2.5 tabular-nums text-ink">{formatDateShort(a.date)}</td>
                        <td className="px-4 py-2.5 font-semibold text-ink">{a.studentName}</td>
                        <td className="px-4 py-2.5 text-ink">{a.className}</td>
                        <td className="px-4 py-2.5 text-ink">{a.teacherName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-muted">{a.reason ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {!a.makeupId ? (
                            <span className="rounded-md border border-alert bg-alert-soft px-2 py-0.5 text-xs font-semibold text-alert">
                              미등록
                            </span>
                          ) : (
                            <span
                              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${statusChip(a.makeupStatus ?? "PLANNED")}`}
                            >
                              {MAKEUP_STATUS_LABEL[a.makeupStatus ?? "PLANNED"]}
                              {a.makeupDate ? ` · ${formatDateShort(a.makeupDate)}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {!a.makeupId ? (
                            <button
                              type="button"
                              className="btn px-2.5 py-1 text-xs"
                              onClick={() => fillFrom(a)}
                            >
                              보강 잡기
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 보강 일정 */}
          <section className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3">
              <h2 className="text-base font-bold text-ink">보강 일정</h2>
              <p className="mt-0.5 text-xs text-muted">
                예정된 보강은 담당 선생님의 대시보드와 시간표에도 표시됩니다.
              </p>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-navy-50 text-left text-xs font-semibold text-muted">
                    <th className="px-5 py-2.5">보강일</th>
                    <th className="px-4 py-2.5">시간</th>
                    <th className="px-4 py-2.5">학생</th>
                    <th className="px-4 py-2.5">강의실</th>
                    <th className="px-4 py-2.5">담당</th>
                    <th className="px-4 py-2.5">메모</th>
                    <th className="w-24 px-4 py-2.5">상태</th>
                    <th className="w-28 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.makeups ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-muted">
                        등록된 보강이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    (data?.makeups ?? []).map((m) => (
                      <tr key={m.id} className="border-b border-line last:border-b-0">
                        <td className="px-5 py-2.5 tabular-nums text-ink">{formatDateShort(m.date)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-ink">
                          {rangeLabel(m.startMin, m.endMin)}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-ink">
                          {m.studentName}
                          {m.className ? <span className="ml-1 text-xs text-muted">{m.className}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-ink">{m.roomName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-ink">{m.teacherName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-muted">{m.note ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${statusChip(m.status)}`}
                          >
                            {MAKEUP_STATUS_LABEL[m.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1">
                            {m.status === "DONE" ? (
                              <button
                                type="button"
                                className="btn btn-ghost px-1.5 py-1"
                                title="예정으로 되돌리기"
                                disabled={busy}
                                onClick={() => void setStatus(m, "PLANNED")}
                              >
                                <IconRefresh className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn px-2 py-1 text-xs"
                                disabled={busy}
                                onClick={() => void setStatus(m, "DONE")}
                              >
                                <IconCheck className="h-3.5 w-3.5" />
                                완료
                              </button>
                            )}
                            {canDelete ? (
                              <button
                                type="button"
                                className="btn btn-ghost px-1.5 py-1 text-alert"
                                onClick={() => void remove(m)}
                                aria-label="삭제"
                              >
                                <IconTrash className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* 보강 등록 */}
        <aside className="card w-[320px] shrink-0 self-start p-5">
          <h2 className="text-base font-bold text-ink">보강 등록</h2>

          <div className="mt-4 space-y-3">
            <div>
              <label className="label">학생</label>
              <Combobox
                options={studentOptions}
                value={form.student}
                allowCreate={false}
                placeholder="학생 이름 검색"
                onChange={(v) => {
                  const st = students.find((s) => s.id === v.id);
                  setForm({ ...form, student: v, classId: st?.classIds[0] ?? form.classId });
                }}
              />
            </div>

            {form.absentDate ? (
              <div className="rounded-lg border border-line bg-navy-50 px-3 py-2 text-xs text-navy-700">
                {formatDateShort(form.absentDate)} 결석에 대한 보강입니다.
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => setForm({ ...form, absentDate: null })}
                >
                  연결 해제
                </button>
              </div>
            ) : null}

            <div>
              <label className="label">보강 날짜</label>
              <input
                type="date"
                className="field"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div>
              <label className="label">시작 시간</label>
              <TimeSelect
                value={form.startMin}
                onChange={(v) => setForm({ ...form, startMin: v })}
                allowEmpty
              />
            </div>
            <div>
              <label className="label">종료 시간</label>
              <TimeSelect
                value={form.endMin}
                onChange={(v) => setForm({ ...form, endMin: v })}
                allowEmpty
              />
            </div>

            <div>
              <label className="label">강의실</label>
              <select
                className="field"
                value={form.roomId ?? ""}
                onChange={(e) =>
                  setForm({ ...form, roomId: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                <option value="">선택</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">담당 선생님</label>
              <select
                className="field"
                value={form.teacherId ?? ""}
                onChange={(e) =>
                  setForm({ ...form, teacherId: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                <option value="">선택</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">메모</label>
              <input
                className="field"
                value={form.note}
                placeholder="예) 감기 결석 보강"
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={busy}
              onClick={() => void create()}
            >
              보강 등록
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setForm(emptyForm())}>
              비우기
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
