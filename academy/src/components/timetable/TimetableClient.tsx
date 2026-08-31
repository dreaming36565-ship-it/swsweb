"use client";

// 시간표 관리 — 왼쪽 입력(300px) / 오른쪽 시간표 2분할.
// 관리자만 입력창을 본다. 일반 선생님·데스크는 학원 전체 시간표를 조회만 한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import Combobox, { type ComboValue } from "../Combobox";
import TimeSelect from "../TimeSelect";
import { useConfirm } from "../ConfirmDialog";
import { IconTrash, IconWarning } from "../Icons";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { classColor } from "@/lib/colors";
import { DAY_LABELS, STEP, fmtTime, formatDateShort, parseDateKey, rangeLabel } from "@/lib/time";
import {
  SESSION_TYPE_LABEL,
  type ClassRow,
  type Conflict,
  type Department,
  type Makeup,
  type Room,
  type SessionType,
  type SessionUser,
  type SrAssignment,
  type TimetableSession,
} from "@/lib/types";

type Payload = {
  day: number;
  sessions: TimetableSession[];
  rooms: Room[];
  classes: ClassRow[];
  teachers: { id: number; name: string; department: Department }[];
  srAssignments: SrAssignment[];
  conflicts: Conflict[];
  makeups: Makeup[];
};

const ROW_H = 22; // 10분당 높이(px)

const emptyForm = (department: Department, day: number) => ({
  id: null as number | null,
  /** 같은 수업이 주 2~3회인 경우가 많아 요일을 여러 개 고를 수 있다 */
  days: [day] as number[],
  classValue: { id: null, name: "" } as ComboValue,
  department,
  type: "REGULAR" as SessionType,
  startMin: null as number | null,
  endMin: null as number | null,
  alphaStartMin: null as number | null,
  alphaEndMin: null as number | null,
  roomValue: { id: null, name: "" } as ComboValue,
  alphaRoomValue: { id: null, name: "" } as ComboValue,
  teacherId: null as number | null,
});

export default function TimetableClient({ user }: { user: SessionUser }) {
  const canEdit = user.role === "ADMIN";
  const confirm = useConfirm();

  const [day, setDay] = useState<number>(() => new Date().getDay());
  const [dept, setDept] = useState<"ALL" | Department>("ALL");
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState(() => emptyForm(user.department, new Date().getDay()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<Payload>(`/api/timetable?day=${day}&dept=${dept}`);
      setData(payload);
      // 알파 강의실 기본값은 SR룸
      setForm((f) =>
        f.alphaRoomValue.id === null && f.alphaRoomValue.name === ""
          ? {
              ...f,
              alphaRoomValue: (() => {
                const sr = payload.rooms.find((r) => r.isSr === 1);
                return sr ? { id: sr.id, name: sr.name } : f.alphaRoomValue;
              })(),
            }
          : f,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [day, dept]);

  useEffect(() => {
    void load();
  }, [load]);

  const rooms = data?.rooms ?? [];
  const sessions = data?.sessions ?? [];
  const conflicts = data?.conflicts ?? [];

  // 보강은 특정 날짜에 1회 잡히므로, 지금 보고 있는 요일과 같은 날의 예정 보강만 함께 그린다
  const dayMakeups = useMemo(
    () => (data?.makeups ?? []).filter((m) => parseDateKey(m.date).getDay() === day),
    [data, day],
  );

  // 세로축 범위 자동 조정 — 토요일 오전 수업도 보이도록
  const { gridStart, gridEnd } = useMemo(() => {
    const points: number[] = [];
    for (const s of sessions) {
      points.push(s.startMin, s.endMin);
      if (s.alphaStartMin !== null) points.push(s.alphaStartMin);
      if (s.alphaEndMin !== null) points.push(s.alphaEndMin);
    }
    for (const m of dayMakeups) points.push(m.startMin, m.endMin);
    if (points.length === 0) return { gridStart: 14 * 60, gridEnd: 22 * 60 };
    const min = Math.min(...points);
    const max = Math.max(...points);
    return {
      gridStart: Math.floor((min - STEP) / 60) * 60,
      gridEnd: Math.ceil((max + STEP) / 60) * 60,
    };
  }, [sessions, dayMakeups]);

  const slots = Math.max(1, (gridEnd - gridStart) / STEP);

  /** 강의실별 보강 블록 */
  const makeupsByRoom = useMemo(() => {
    const map = new Map<number, Makeup[]>();
    for (const m of dayMakeups) {
      if (m.roomId === null) continue;
      const list = map.get(m.roomId) ?? [];
      list.push(m);
      map.set(m.roomId, list);
    }
    return map;
  }, [dayMakeups]);

  const blocksByRoom = useMemo(() => {
    const map = new Map<number, { key: string; session: TimetableSession; start: number; end: number; isAlpha: boolean }[]>();
    for (const s of sessions) {
      if (s.roomId !== null) {
        const list = map.get(s.roomId) ?? [];
        list.push({ key: `c${s.id}`, session: s, start: s.startMin, end: s.endMin, isAlpha: false });
        map.set(s.roomId, list);
      }
      if (s.alphaRoomId !== null && s.alphaStartMin !== null && s.alphaEndMin !== null) {
        const list = map.get(s.alphaRoomId) ?? [];
        list.push({
          key: `a${s.id}`,
          session: s,
          start: s.alphaStartMin,
          end: s.alphaEndMin,
          isAlpha: true,
        });
        map.set(s.alphaRoomId, list);
      }
    }
    return map;
  }, [sessions]);

  const conflictIds = useMemo(() => new Set(conflicts.flatMap((c) => c.sessionIds)), [conflicts]);

  const startEdit = (s: TimetableSession) => {
    if (!canEdit) return;
    setError(null);
    setForm({
      id: s.id,
      days: [s.dayOfWeek],
      classValue: { id: s.classId, name: s.className },
      department: s.department,
      type: s.type,
      startMin: s.startMin,
      endMin: s.endMin,
      alphaStartMin: s.alphaStartMin,
      alphaEndMin: s.alphaEndMin,
      roomValue: { id: s.roomId, name: s.roomName ?? "" },
      alphaRoomValue: { id: s.alphaRoomId, name: s.alphaRoomName ?? "" },
      teacherId: s.teacherId,
    });
  };

  const resetForm = () => {
    const sr = rooms.find((r) => r.isSr === 1);
    setForm({
      ...emptyForm(user.department, day),
      alphaRoomValue: sr ? { id: sr.id, name: sr.name } : { id: null, name: "" },
    });
  };

  const toggleDay = (d: number) => {
    setForm((f) => {
      if (f.id) return { ...f, days: [d] }; // 수정 중에는 요일 하나만
      const has = f.days.includes(d);
      const next = has ? f.days.filter((x) => x !== d) : [...f.days, d].sort();
      return { ...f, days: next };
    });
  };

  const submit = async () => {
    setError(null);
    if (!form.classValue.name.trim()) {
      setError("반을 선택하거나 입력해 주세요.");
      return;
    }
    if (form.startMin === null || form.endMin === null) {
      setError("수업 시작시간과 종료시간을 선택해 주세요.");
      return;
    }
    if (form.days.length === 0) {
      setError("요일을 하나 이상 선택해 주세요.");
      return;
    }
    setBusy(true);
    const body = {
      id: form.id ?? undefined,
      dayOfWeek: form.days[0],
      days: form.days,
      classId: form.classValue.id,
      className: form.classValue.name,
      department: form.department,
      type: form.type,
      startMin: form.startMin,
      endMin: form.endMin,
      alphaStartMin: form.alphaStartMin,
      alphaEndMin: form.alphaEndMin,
      roomId: form.roomValue.id,
      roomName: form.roomValue.name,
      alphaRoomId: form.alphaRoomValue.id,
      alphaRoomName: form.alphaRoomValue.name,
      teacherId: form.teacherId,
    };
    try {
      if (form.id) {
        await apiPatch("/api/timetable/session", body);
      } else {
        await apiPost("/api/timetable/session", body);
        // 지금 보고 있는 요일에 안 넣었으면, 넣은 요일로 옮겨서 바로 확인되게 한다
        if (!form.days.includes(day)) setDay(form.days[0]);
      }
      resetForm();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!form.id) return;
    const yes = await confirm({
      title: "수업을 삭제할까요?",
      message: `${form.classValue.name} 수업을 시간표에서 지웁니다. 해당 요일의 SR 자리도 다시 계산됩니다.`,
      confirmText: "삭제",
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      await apiDelete("/api/timetable/session", { id: form.id });
      resetForm();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* 충돌 경고 바 — 페이지 상단 전체 폭 */}
      {conflicts.length > 0 ? (
        <div className="rounded-xl border border-alert bg-alert-soft px-5 py-4">
          <div className="flex items-center gap-2 font-bold text-alert">
            <IconWarning className="h-5 w-5" />
            시간표 충돌이 감지되었습니다. ({conflicts.length}건)
          </div>
          <ul className="mt-2 space-y-1 text-sm text-alert">
            {conflicts.map((c, i) => (
              <li key={i}>· {c.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 요일 / 부서 */}
      <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-1">
          {DAY_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setDay(i)}
              className={`h-9 w-11 rounded-lg text-sm font-bold transition-colors ${
                day === i ? "bg-navy-800 text-white" : "text-muted hover:bg-navy-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="field w-40"
          value={dept}
          onChange={(e) => setDept(e.target.value as "ALL" | Department)}
        >
          <option value="ALL">전체 부서</option>
          <option value="ELEM">초중등부</option>
          <option value="HIGH">고등부</option>
        </select>
      </div>

      <div className="flex w-full gap-4">
        {/* 왼쪽 — 입력 (관리자만) */}
        {canEdit ? (
          <aside className="card w-[300px] shrink-0 self-start p-5">
            <h2 className="text-base font-bold text-ink">
              {form.id ? "수업 수정" : "시간표 입력"}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="label">
                  요일{form.id ? "" : " (여러 개 선택 가능)"}
                </label>
                <div className="flex gap-1">
                  {DAY_LABELS.map((label, i) => {
                    const on = form.days.includes(i);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleDay(i)}
                        className={`h-8 flex-1 rounded-md border text-sm font-bold transition-colors ${
                          on
                            ? "border-navy-800 bg-navy-800 text-white"
                            : "border-line bg-white text-muted hover:bg-navy-50"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {!form.id ? (
                  <p className="mt-1 text-xs text-muted">
                    월·수·금처럼 여러 요일을 고르면 한 번에 다 들어갑니다.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="label">부서</label>
                <select
                  className="field"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value as Department })}
                >
                  <option value="ELEM">초중등부</option>
                  <option value="HIGH">고등부</option>
                </select>
              </div>

              <div>
                <label className="label">반</label>
                <Combobox
                  options={(data?.classes ?? []).map((c) => ({
                    id: c.id,
                    label: c.name,
                    hint: c.teacherName ?? undefined,
                  }))}
                  value={form.classValue}
                  onChange={(v) => setForm({ ...form, classValue: v })}
                  placeholder="반 선택 또는 직접 입력"
                />
              </div>

              <div>
                <label className="label">수업 종류</label>
                <select
                  className="field"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as SessionType })}
                >
                  {Object.entries(SESSION_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">수업 시작</label>
                <TimeSelect
                  value={form.startMin}
                  onChange={(v) => setForm({ ...form, startMin: v })}
                  allowEmpty
                />
              </div>
              <div>
                <label className="label">수업 종료</label>
                <TimeSelect
                  value={form.endMin}
                  onChange={(v) => setForm({ ...form, endMin: v })}
                  allowEmpty
                />
              </div>

              <div>
                <label className="label">강의실</label>
                <Combobox
                  options={rooms.filter((r) => r.isSr !== 1).map((r) => ({ id: r.id, label: r.name }))}
                  value={form.roomValue}
                  onChange={(v) => setForm({ ...form, roomValue: v })}
                  placeholder="강의실 선택 또는 직접 입력"
                />
              </div>

              <div>
                <label className="label">알파 시작</label>
                <TimeSelect
                  value={form.alphaStartMin}
                  onChange={(v) => setForm({ ...form, alphaStartMin: v })}
                  allowEmpty
                  emptyLabel="없음"
                />
              </div>
              <div>
                <label className="label">알파 종료</label>
                <TimeSelect
                  value={form.alphaEndMin}
                  onChange={(v) => setForm({ ...form, alphaEndMin: v })}
                  allowEmpty
                  emptyLabel="없음"
                />
              </div>

              <div>
                <label className="label">알파 강의실</label>
                <select
                  className="field"
                  value={form.alphaRoomValue.id ?? ""}
                  onChange={(e) => {
                    const id = e.target.value === "" ? null : Number(e.target.value);
                    const room = rooms.find((r) => r.id === id);
                    setForm({ ...form, alphaRoomValue: { id, name: room?.name ?? "" } });
                  }}
                >
                  <option value="">선택</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.isSr === 1 ? " (SR)" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">SR룸을 고르면 좌석이 자동 배정됩니다.</p>
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
                  {(data?.teachers ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error ? (
              <div className="mt-3 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
                {error}
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-primary flex-1" onClick={() => void submit()} disabled={busy}>
                입력완료
              </button>
              {form.id ? (
                <>
                  <button type="button" className="btn" onClick={resetForm} disabled={busy}>
                    취소
                  </button>
                  <button type="button" className="btn btn-danger px-2.5" onClick={() => void remove()} disabled={busy}>
                    <IconTrash className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </div>
          </aside>
        ) : null}

        {/* 오른쪽 — 시간표 */}
        <section className="card min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-bold text-ink">{DAY_LABELS[day]}요일 시간표</h2>
            <span className="text-xs text-muted">
              {fmtTime(gridStart)} ~ {fmtTime(gridEnd)} · 10분 단위
              {dayMakeups.length > 0 ? ` · 보강 ${dayMakeups.length}건` : ""}
            </span>
          </div>

          <div className="overflow-auto">
            <div className="flex min-w-[720px]">
              {/* 시간 눈금 */}
              <div className="w-24 shrink-0 border-r border-line">
                <div className="h-9 border-b border-line" />
                <div className="relative" style={{ height: slots * ROW_H }}>
                  {Array.from({ length: slots }, (_, i) => {
                    const m = gridStart + i * STEP;
                    const onHour = m % 60 === 0;
                    return (
                      <div
                        key={m}
                        className={`absolute left-0 right-0 border-t text-[11px] tabular-nums ${
                          onHour ? "border-line text-muted" : "border-transparent text-transparent"
                        }`}
                        style={{ top: i * ROW_H, height: ROW_H }}
                      >
                        <span className="pl-2">{onHour ? fmtTime(m) : ""}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 강의실 열 */}
              {rooms.map((room) => (
                <div key={room.id} className="min-w-[120px] flex-1 border-r border-line last:border-r-0">
                  <div className="flex h-9 items-center justify-center border-b border-line text-sm font-bold text-navy-800">
                    {room.name}
                  </div>
                  <div className="relative" style={{ height: slots * ROW_H }}>
                    {Array.from({ length: slots }, (_, i) => (
                      <div
                        key={i}
                        className={`absolute left-0 right-0 border-t ${
                          (gridStart + i * STEP) % 60 === 0 ? "border-line" : "border-navy-50"
                        }`}
                        style={{ top: i * ROW_H, height: ROW_H }}
                      />
                    ))}

                    {(blocksByRoom.get(room.id) ?? []).map((b) => {
                      const color = classColor(b.session.classId);
                      const top = ((b.start - gridStart) / STEP) * ROW_H;
                      const height = Math.max(ROW_H, ((b.end - b.start) / STEP) * ROW_H);
                      const bad = conflictIds.has(b.session.id);
                      return (
                        <button
                          key={b.key}
                          type="button"
                          onClick={() => startEdit(b.session)}
                          className={`absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 text-left transition-shadow ${
                            canEdit ? "hover:shadow-md" : "cursor-default"
                          } ${bad ? "ring-2 ring-alert" : ""}`}
                          style={{
                            top,
                            height,
                            background: b.isAlpha ? "#fff" : color.bg,
                            borderColor: color.border,
                            color: color.text,
                          }}
                          title={`${b.session.className} ${rangeLabel(b.start, b.end)}`}
                        >
                          <div className="truncate text-xs font-bold">
                            {b.session.className}
                            {b.isAlpha ? " 알파" : ""}
                          </div>
                          {height > ROW_H * 2 ? (
                            <>
                              <div className="truncate text-[11px] opacity-80">
                                {b.isAlpha ? "알파" : SESSION_TYPE_LABEL[b.session.type]}
                                {b.session.teacherName ? ` · ${b.session.teacherName}` : ""}
                              </div>
                              <div className="truncate text-[11px] tabular-nums opacity-70">
                                {rangeLabel(b.start, b.end)}
                              </div>
                            </>
                          ) : null}
                        </button>
                      );
                    })}

                    {/* 보강 — 특정 날짜 1회라 점선으로 구분해 그린다 */}
                    {(makeupsByRoom.get(room.id) ?? []).map((m) => {
                      const top = ((m.startMin - gridStart) / STEP) * ROW_H;
                      const height = Math.max(ROW_H, ((m.endMin - m.startMin) / STEP) * ROW_H);
                      return (
                        <div
                          key={`m${m.id}`}
                          className="absolute left-1 right-1 overflow-hidden rounded-md border-2 border-dashed border-late bg-late-soft px-2 py-1 text-left text-late"
                          style={{ top, height }}
                          title={`${m.studentName} 보강 · ${formatDateShort(m.date)} ${rangeLabel(m.startMin, m.endMin)}`}
                        >
                          <div className="truncate text-xs font-bold">{m.studentName} 보강</div>
                          {height > ROW_H * 2 ? (
                            <>
                              <div className="truncate text-[11px] opacity-80">
                                {formatDateShort(m.date)}
                                {m.teacherName ? ` · ${m.teacherName}` : ""}
                              </div>
                              <div className="truncate text-[11px] tabular-nums opacity-70">
                                {rangeLabel(m.startMin, m.endMin)}
                              </div>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
