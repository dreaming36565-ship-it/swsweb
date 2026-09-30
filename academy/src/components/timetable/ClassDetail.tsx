"use client";

// 반 상세 — 담당 · 전체 수업시간 · 칸별 세부 시간표 · 학생 명단(명단 고치기: 관리자·선생님·데스크)

import { useState } from "react";
import Modal from "../Modal";
import { apiPatch, errorMessage } from "@/lib/http";
import { can } from "@/lib/perm";
import { teacherLabel, type ClassPart } from "@/lib/types";
import { course, dayLabel, onDay, ownerLabel, timeSpan } from "./model";
import { DAY_LABELS } from "@/lib/time";
import { DayTable, PartBooksModal } from "./views";
import type { Ctx } from "./TimetableClient";

export default function ClassDetail({ ctx, classId, day, onClose }: { ctx: Ctx; classId: number; day?: number; onClose: () => void }) {
  const found = ctx.data.classes.find((x) => x.id === classId);
  // 숙제반은 누른 요일의 학생만 (요일 없이 열면 이번 달 전체)
  const perDay = !!found && day !== undefined && found.students.some((s) => s.days);
  const c = found && perDay ? onDay(found, day!) : found;
  const [editRoster, setEditRoster] = useState(false);
  const [names, setNames] = useState<string[]>(() => c?.students.map((s) => s.name) ?? []);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bookFor, setBookFor] = useState<ClassPart | null>(null);
  if (!c) return null;

  const allNames = [...new Set(ctx.data.classes.flatMap((x) => x.students.map((s) => s.name)))].sort((a, b) => a.localeCompare(b, "ko"));
  const saveRoster = async (next: string[]) => {
    setError(null);
    try {
      await apiPatch("/api/classes", { id: c.id, students: next });
      setNames(next);
      await ctx.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      width={980}
      title={`${perDay ? `${DAY_LABELS[day!]} ` : ""}${c.name} (${c.students.length}명)`}
      subtitle={`${c.grade ?? ""} · ${course(c, ctx.data.books) || c.textbook || ""}`}
      onClose={onClose}
      footer={
        <>
          {can(ctx.user, "timetable.write") ? (
            <button type="button" className="btn" onClick={() => ctx.editClass(c.id)}>
              편집
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            닫기
          </button>
        </>
      }
    >
      <div className="mb-3 flex gap-6 text-sm">
        <div>
          <span className="label">담당</span>
          {ownerLabel(c)}
        </div>
        <div>
          <span className="label">전체 수업시간</span>
          {dayLabel(c.days)} {timeSpan(c)}
        </div>
        {c.hapbanWith ? (
          <div>
            <span className="label">🔗 합반</span>
            <button type="button" className="font-bold text-navy-800 hover:underline" onClick={() => ctx.openClass(c.hapbanWith!)}>
              {ctx.data.classes.find((x) => x.id === c.hapbanWith)?.name ?? "—"}
            </button>
          </div>
        ) : null}
      </div>
      <b className="text-sm">과정별 세부 시간표</b>
      <DayTable ctx={ctx} c={c} onEditBooks={(p) => setBookFor(p)} />

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <b className="text-sm">학생 명단</b>
          {c.grade === "숙제반" ? <span className="text-xs text-muted">{perDay ? `${DAY_LABELS[day!]}요일에 오는 학생 · ` : ""}숙제반 명단은 숙제 관리에서 (이번 달 신청 · 강제 숙제반)</span> : null}
          {can(ctx.user, "students.write") && !editRoster && c.grade !== "숙제반" ? (
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setEditRoster(true)}>
              ✏️ 명단 고치기
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {names.length === 0 ? <span className="text-sm text-muted">없음</span> : null}
          {names.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full border border-line bg-navy-50 px-2.5 py-0.5 text-xs">
              {n}
              {editRoster ? (
                <button type="button" className="text-muted" onClick={() => void saveRoster(names.filter((x) => x !== n))} title="이 반에서 빼기">
                  ✕
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {editRoster ? (
          <div className="mt-2">
            <div className="flex gap-2">
              <input
                className="field w-60"
                list="roster-names"
                placeholder="이름 입력 후 Enter"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !input.trim()) return;
                  const n = input.trim();
                  setInput("");
                  if (!names.includes(n)) void saveRoster([...names, n]);
                }}
                autoFocus
              />
              <button type="button" className="btn" onClick={() => setEditRoster(false)}>
                완료
              </button>
            </div>
            <datalist id="roster-names">
              {allNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-muted">같은 이름의 학생이 있으면 그 학생이 이 반에도 들어가요. ✕ = 이 반에서만 빼기. 바꾸면 SR 자리도 다시 맞춰져요.</p>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
      </div>
      {bookFor ? <PartBooksModal ctx={ctx} c={c} p={bookFor} onClose={() => setBookFor(null)} /> : null}
    </Modal>
  );
}
