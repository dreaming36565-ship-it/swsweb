"use client";

// 반 편집 (관리자) — 반 정보 + 칸(수업 · SR, 칸마다 요일 · 교재) + 학생.
// 한 요일에는 수업 칸 1개 + SR 칸 1개까지 (출결 · SR 자리가 요일마다 한 번이라서).

import { useState } from "react";
import Modal from "../Modal";
import TimeSelect from "../TimeSelect";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { bookFull, bookShort } from "@/lib/books";
import { DAY_LABELS, rangeLabel } from "@/lib/time";
import { CHANGE_LABEL, teacherLabel, type Book, type ClassPart } from "@/lib/types";
import { GRADE_ORDER, WEEK, weekOrder } from "./model";
import type { Ctx } from "./TimetableClient";

type Part = Pick<ClassPart, "kind" | "label" | "start" | "end" | "roomId" | "teacherId" | "days" | "bookIds">;
type Draft = {
  name: string;
  department: "ELEM" | "HIGH";
  grade: string;
  customGrade: boolean;
  level: string;
  teacherId: number | null;
  days: number[];
  parts: Part[];
  students: string[];
  /** 🔗 합반 상대 반 */
  hapbanWith: number | null;
  /** 반레벨 변경 · 교체 표시 (""= 자동, N = 없음, T/H/B = 직접) */
  levelChanged: boolean;
  changeKind: string;
  changeNote: string;
};

const sortDays = (d: number[]) => [...new Set(d)].sort((a, b) => weekOrder(a) - weekOrder(b));

export default function ClassEditor({ ctx, classId, onClose }: { ctx: Ctx; classId: number | null; onClose: () => void }) {
  const { rooms, teachers } = ctx.data;
  const sr = rooms.find((r) => r.isSr === 1);
  const firstRoom = rooms.find((r) => r.isSr !== 1);
  const [books, setBooks] = useState<Book[]>(ctx.data.books);
  const [d, setD] = useState<Draft>(() => {
    const c = ctx.data.classes.find((x) => x.id === classId);
    if (c)
      return {
        name: c.name,
        department: c.department,
        grade: c.grade ?? "",
        customGrade: !!c.grade && !GRADE_ORDER.includes(c.grade),
        level: c.level ?? "",
        teacherId: c.teacherId,
        days: c.days,
        parts: c.parts.map((p) => ({ ...p })),
        students: c.students.map((s) => s.name),
        hapbanWith: c.hapbanWith,
        levelChanged: c.levelChanged,
        changeKind: c.changeKind ?? "",
        changeNote: c.changeNote ?? "",
      };
    return {
      name: "",
      department: "ELEM",
      grade: "초5",
      customGrade: false,
      level: "",
      teacherId: teachers[0]?.id ?? null,
      days: [1, 3],
      parts: [
        { kind: "CLASS", label: "수업", start: 14 * 60 + 40, end: 16 * 60 + 20, roomId: firstRoom?.id ?? null, teacherId: teachers[0]?.id ?? null, days: [1, 3], bookIds: [] },
      ],
      students: [],
      hapbanWith: null,
      levelChanged: false,
      changeKind: "",
      changeNote: "",
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stu, setStu] = useState("");

  const setPart = (i: number, patch: Partial<Part>) => setD((x) => ({ ...x, parts: x.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const toggleDay = (day: number) =>
    setD((x) => {
      const on = x.days.includes(day);
      const days = on ? x.days.filter((y) => y !== day) : sortDays([...x.days, day]);
      // 반에서 빠진 요일은 칸에서도 빠지고, 새로 넣은 요일은 모든 칸에 들어간다
      return { ...x, days, parts: x.parts.map((p) => ({ ...p, days: on ? p.days.filter((y) => y !== day) : sortDays([...p.days, day]) })) };
    });

  const addBook = async (i: number, text: string) => {
    if (!text.trim()) return;
    try {
      const { id } = await apiPost<{ id: number }>("/api/books", { text });
      setBooks((await apiGet<{ books: Book[] }>("/api/books")).books);
      setPart(i, { bookIds: [...new Set([...d.parts[i].bookIds, id])] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const save = async () => {
    setError(null);
    if (d.customGrade && !d.level) return setError("직접 입력한 학년은 학교급(초등·중등·고등)을 골라 주세요.");
    setBusy(true);
    try {
      await apiPost("/api/classes", {
        id: classId,
        name: d.name,
        department: d.department,
        grade: d.grade,
        level: d.customGrade ? d.level : null,
        teacherId: d.teacherId,
        days: d.days,
        parts: d.parts.map((p) => ({ ...p, teacherId: p.kind === "SR" ? null : p.teacherId })),
        students: d.students,
        hapbanWith: d.hapbanWith,
        levelChanged: d.levelChanged,
        changeKind: d.changeKind || null,
        changeNote: d.changeNote,
      });
      await ctx.reload();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // 🔗 합반 후보 — 같은 요일 · 같은 강의실 · 같은 선생님으로 수업 시간이 겹치는 반
  const hapbanOptions = ctx.data.classes
    .filter((o) => o.id !== classId)
    .map((o) => {
      const hit = o.parts.find(
        (op) =>
          op.kind === "CLASS" &&
          d.parts.some(
            (p) =>
              p.kind === "CLASS" &&
              p.roomId === op.roomId &&
              p.teacherId !== null &&
              p.teacherId === op.teacherId &&
              p.start < op.end &&
              op.start < p.end &&
              p.days.some((x) => op.days.includes(x)),
          ),
      );
      return hit ? { c: o, p: hit } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const hapbanCur = ctx.data.classes.find((o) => o.id === d.hapbanWith);
  const hapbanLabel = (o: (typeof hapbanOptions)[number]) =>
    `${o.c.name} — ${o.p.days.map((x) => DAY_LABELS[x]).join("·")} ${rangeLabel(o.p.start, o.p.end)} · ${o.p.roomName ?? ""} · ${teacherLabel(o.p.teacherName)}`;

  const derived = [...new Set(d.parts.flatMap((p) => p.bookIds))]
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => !!b)
    .map(bookShort)
    .join(", ");

  return (
    <Modal
      open
      width={1000}
      title={classId ? `${d.name} 편집` : "새 반"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "저장 중…" : "입력완료"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-5 gap-2.5">
        <div>
          <label className="label">반 이름</label>
          <input className="field" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </div>
        <div>
          <label className="label">학년</label>
          {d.customGrade ? (
            <>
              <div className="flex gap-1">
                <input className="field" placeholder="예) 초등 영재반" value={d.grade} onChange={(e) => setD({ ...d, grade: e.target.value })} />
                <select className="field w-24" title="SR 자리 규칙(고등↔초등 멀리)에 써요" value={d.level} onChange={(e) => setD({ ...d, level: e.target.value })}>
                  <option value="">학교급</option>
                  {["초등", "중등", "고등"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn mt-1 px-2 py-0.5 text-xs" onClick={() => setD({ ...d, customGrade: false, grade: "초5" })}>
                목록에서 고르기
              </button>
            </>
          ) : (
            <select
              className="field"
              value={d.grade}
              onChange={(e) => (e.target.value === "__custom" ? setD({ ...d, customGrade: true, grade: "" }) : setD({ ...d, grade: e.target.value }))}
            >
              {GRADE_ORDER.map((g) => (
                <option key={g}>{g}</option>
              ))}
              <option value="__custom">직접 입력…</option>
            </select>
          )}
        </div>
        <div>
          <label className="label">담임선생님</label>
          <select className="field" value={d.teacherId ?? ""} onChange={(e) => setD({ ...d, teacherId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">미정</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">부서</label>
          <select className="field" value={d.department} onChange={(e) => setD({ ...d, department: e.target.value as Draft["department"] })}>
            <option value="ELEM">초중등부</option>
            <option value="HIGH">고등부</option>
          </select>
        </div>
        <div>
          <label className="label">학습과정 (교재로 자동)</label>
          <input className="field" readOnly value={derived || "—"} />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">수업 요일</label>
        <div className="flex flex-wrap gap-3">
          {WEEK.map((day) => (
            <label key={day} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={d.days.includes(day)} onChange={() => toggleDay(day)} />
              {DAY_LABELS[day]}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label className="label">칸 (과정)</label>
        {d.parts.map((p, i) => (
          <div key={i} className="mb-2 rounded-xl border border-line bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <select className="field w-24" value={p.kind} onChange={(e) => setPart(i, { kind: e.target.value as Part["kind"], ...(e.target.value === "SR" ? { roomId: sr?.id ?? p.roomId, label: "SR" } : {}) })}>
                <option value="CLASS">수업 칸</option>
                <option value="SR">SR 칸</option>
              </select>
              <TimeSelect className="w-44" value={p.start} onChange={(v) => v !== null && setPart(i, { start: v })} />~
              <TimeSelect className="w-44" value={p.end} onChange={(v) => v !== null && setPart(i, { end: v })} />
              <input className="field w-28" value={p.label} placeholder="수업/SR/TEST" onChange={(e) => setPart(i, { label: e.target.value })} />
              <select className="field w-28" value={p.roomId ?? ""} onChange={(e) => setPart(i, { roomId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">강의실</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {p.kind === "CLASS" ? (
                <select className="field w-28" value={p.teacherId ?? ""} onChange={(e) => setPart(i, { teacherId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">담당 미정</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted">담당 = SR</span>
              )}
              <button type="button" className="btn btn-danger ml-auto px-2 py-0.5 text-xs" disabled={d.parts.length === 1} onClick={() => setD({ ...d, parts: d.parts.filter((_, j) => j !== i) })}>
                삭제
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="label mb-0">이 칸의 요일</span>
              {d.days.map((day) => (
                <label key={day} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={p.days.includes(day)}
                    onChange={() => setPart(i, { days: p.days.includes(day) ? p.days.filter((y) => y !== day) : sortDays([...p.days, day]) })}
                  />
                  {DAY_LABELS[day]}
                </label>
              ))}
              {d.days.every((x) => p.days.includes(x)) ? (
                <span className="text-xs text-muted">= 반 요일 전체</span>
              ) : (
                <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setPart(i, { days: [...d.days] })}>
                  전체 요일로 되돌리기
                </button>
              )}
            </div>
            {p.kind === "CLASS" ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="label mb-0">교재</span>
                {p.bookIds.map((id) => {
                  const b = books.find((x) => x.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border border-line bg-navy-50 px-2 py-0.5 text-xs">
                      {b ? bookShort(b) : "—"}
                      <button type="button" className="text-muted" onClick={() => setPart(i, { bookIds: p.bookIds.filter((x) => x !== id) })}>
                        ✕
                      </button>
                    </span>
                  );
                })}
                <input
                  className="field w-52 py-1 text-xs"
                  list="editor-books"
                  placeholder="＋ 교재 (예: 초등 5-1 심화) Enter"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const el = e.currentTarget;
                      void addBook(i, el.value).then(() => (el.value = ""));
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
        <datalist id="editor-books">
          {books.map((b) => (
            <option key={b.id} value={bookFull(b)} />
          ))}
        </datalist>
        <button
          type="button"
          className="btn px-2.5 py-1 text-xs"
          onClick={() => {
            const last = d.parts[d.parts.length - 1];
            setD({ ...d, parts: [...d.parts, { kind: "SR", label: "SR", start: last?.end ?? 16 * 60, end: (last?.end ?? 16 * 60) + 50, roomId: sr?.id ?? null, teacherId: null, days: [...(last?.days ?? d.days)], bookIds: [] }] });
          }}
        >
          ＋ 칸 추가
        </button>
        <p className="mt-1 text-xs text-muted">한 요일에는 수업 칸 1개 + SR 칸 1개까지 넣을 수 있어요. 수업 없이 SR만 쓰는 반(누적오답 · 숙제반)은 SR 칸만 두면 돼요.</p>
      </div>

      <div className="mt-3 rounded-xl border border-line bg-navy-50 p-3">
        <label className="label">🔗 합반 (같은 교실에서 같이 수업하는 반)</label>
        <select
          className="field"
          value={d.hapbanWith ?? ""}
          onChange={(e) => setD({ ...d, hapbanWith: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">없음</option>
          {hapbanOptions.map((o) => (
            <option key={o.c.id} value={o.c.id}>
              {hapbanLabel(o)}
            </option>
          ))}
          {hapbanCur && !hapbanOptions.some((o) => o.c.id === hapbanCur.id) ? (
            <option value={hapbanCur.id}>{hapbanCur.name} — 지금은 겹치는 수업이 없어요</option>
          ) : null}
        </select>
        <p className="mt-1 text-xs text-muted">
          같은 요일 · 같은 강의실 · 같은 선생님으로 수업이 겹치는 반만 나와요. 합반끼리는 겹침 경고가 없고, 출석체크는 반마다 자기 시작 시각, SR은 같은 열에 이어서 앉아요.
        </p>
        {hapbanOptions.length && !d.hapbanWith ? (
          <p className="mt-1.5 text-sm font-bold text-alert">
            ⚠ 겹침 — {hapbanOptions.map((o) => o.c.name).join(", ")}과(와) 같은 강의실 · 선생님 시간이 겹쳐요. 같이 수업하는 반이면 🔗 합반을 골라 주세요.
          </p>
        ) : d.hapbanWith && hapbanOptions.some((o) => o.c.id === d.hapbanWith) ? (
          <p className="mt-1.5 text-sm font-bold text-ok">✔ {hapbanCur?.name}과(와) 합반 — 겹침 경고 없음</p>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-line bg-navy-50 p-3">
        <label className="label">운영 시간표 표시</label>
        <label className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <input type="checkbox" className="h-[18px] w-[18px]" checked={d.levelChanged} onChange={(e) => setD({ ...d, levelChanged: e.target.checked })} />
          <span className="rounded-md bg-lvl px-1.5 text-white">반레벨 변경</span> (반 이름이 바뀐 반 — 반이름을 보라 바탕으로)
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          교체 색 줄
          <select className="field w-44 py-1" value={d.changeKind} onChange={(e) => setD({ ...d, changeKind: e.target.value })}>
            <option value="">자동 (지난 분기와 비교)</option>
            <option value="N">없음</option>
            {(["T", "H", "B"] as const).map((k) => (
              <option key={k} value={k}>
                {CHANGE_LABEL[k]}
              </option>
            ))}
          </select>
          {d.changeKind && d.changeKind !== "N" ? (
            <input className="field w-56 py-1" placeholder="예) 3분기 희주T+나영T" value={d.changeNote} onChange={(e) => setD({ ...d, changeNote: e.target.value })} />
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted">
          「자동」이면 「📸 분기 마감 저장」해 둔 지난 분기 시간표와 반 이름으로 비교해요 — 담당이 바뀌면 담임교체, 시간이 바뀌면 시간교체.
          {ctx.data.snapshot ? ` 지금 비교 기준: ${ctx.data.snapshot.label} 저장본.` : " 아직 저장본이 없어요."}
        </p>
      </div>

      <div className="mt-3">
        <label className="label">학생 ({d.students.length}명)</label>
        <div className="flex flex-wrap gap-1">
          {d.students.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full border border-line bg-navy-50 px-2.5 py-0.5 text-xs">
              {n}
              <button type="button" className="text-muted" onClick={() => setD({ ...d, students: d.students.filter((x) => x !== n) })}>
                ✕
              </button>
            </span>
          ))}
        </div>
        <input
          className="field mt-1.5 w-60"
          placeholder="이름 입력 후 Enter"
          value={stu}
          onChange={(e) => setStu(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && stu.trim()) {
              if (!d.students.includes(stu.trim())) setD({ ...d, students: [...d.students, stu.trim()] });
              setStu("");
            }
          }}
        />
      </div>
      {error ? <div className="mt-3 rounded-lg bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">{error}</div> : null}
    </Modal>
  );
}
