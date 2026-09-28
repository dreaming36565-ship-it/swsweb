"use client";

import { useMemo, useState, type ReactNode } from "react";
import Modal from "../Modal";
import { useConfirm } from "../ConfirmDialog";
import { IconWarning } from "../Icons";
import { apiDelete, apiGet, apiPost, errorMessage } from "@/lib/http";
import { can } from "@/lib/perm";
import { classColorMap, teacherColor, type ClassColor } from "@/lib/colors";
import { DAY_LABELS, fmtTime, overlaps, rangeLabel } from "@/lib/time";
import { teacherLabel, type Book, type ClassModel, type ClassPart } from "@/lib/types";
import TimeGrid, { dayRange, type GridBlock, type GridColumn } from "./TimeGrid";
import { GRADE_ORDER, alertKey, course, dayLabel, isSwapped, levelOf, mainTeacher, partBooks, partsOn, timeSpan } from "./model";
import type { Ctx } from "./TimetableClient";

/* ------------------------------------------------------------ 공통 */

function dayColors(classes: ClassModel[], day: number) {
  return classColorMap(classes.filter((c) => c.parts.some((p) => p.days.includes(day))).map((c) => c.id));
}

function classBlock(c: ClassModel, p: ClassPart, color: ClassColor | undefined, onClick: () => void, extra?: ReactNode): GridBlock {
  const small = p.end - p.start <= 30;
  return {
    key: `${c.id}-${p.kind}-${p.start}`,
    start: p.start,
    end: p.end,
    color: color ?? null,
    kind: p.kind === "SR" ? "sr" : "class",
    title: `${c.name} ${p.label} ${rangeLabel(p.start, p.end)}`,
    onClick,
    content: (
      <>
        <b className="text-xs">
          {c.name}({c.students.length}명)
        </b>{" "}
        · {p.label}
        <br />
        {rangeLabel(p.start, p.end)}
        {small ? null : (
          <>
            <br />🏫 {p.roomName ?? "—"}
            {p.kind === "CLASS" ? ` · 👤 ${p.teacherName ?? "미정"}` : null}
          </>
        )}
        {extra}
      </>
    ),
  };
}

const TempTag = () => <span className="mt-0.5 block w-fit rounded bg-srpink px-1 text-[10px] font-bold text-white">⇄ 이번 주만</span>;

function ConflictBar({ ctx, day }: { ctx: Ctx; day: number }) {
  const list = ctx.data.conflicts.find((c) => c.day === day)?.list.filter((c) => c.kind !== "ROOM") ?? [];
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-alert bg-alert-soft px-4 py-2 text-sm text-alert">
      <div className="flex items-center gap-2 font-bold">
        <IconWarning className="h-4 w-4" /> {DAY_LABELS[day]}요일 겹침 {list.length}건
      </div>
      <ul className="mt-1 list-disc pl-6 text-xs">
        {list.map((c) => (
          <li key={c.message}>{c.message}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ ① 선생님별 */

export function TeacherView({ ctx, day }: { ctx: Ctx; day: number }) {
  const { classes, teachers, tempSwaps } = ctx.data;
  const colors = dayColors(classes, day);
  const on = classes.flatMap((c) => partsOn(c, day, isSwapped(tempSwaps, c.id, day)).map((p) => ({ c, p })));
  const busy = (id: number) => on.some(({ p }) => p.kind === "CLASS" && p.teacherId === id);
  const list = [...teachers].sort((a, b) => Number(busy(b.id)) - Number(busy(a.id)));
  const block = (c: ClassModel, p: ClassPart) =>
    classBlock(c, p, colors.get(c.id), () => ctx.openClass(c.id), isSwapped(tempSwaps, c.id, day) ? <TempTag /> : null);
  const columns: GridColumn[] = [
    { key: "SR", label: "SR", sub: "SR룸", blocks: on.filter(({ p }) => p.kind === "SR").map(({ c, p }) => block(c, p)) },
    ...list.map((t) => ({
      key: `t${t.id}`,
      label: teacherLabel(t.name),
      sub: busy(t.id) ? "" : "수업 없음",
      blocks: on.filter(({ p }) => p.kind === "CLASS" && p.teacherId === t.id).map(({ c, p }) => block(c, p)),
    })),
  ];
  const orphan = on.filter(({ p }) => p.kind === "CLASS" && !teachers.some((t) => t.id === p.teacherId));
  if (orphan.length) columns.push({ key: "none", label: "담당 미정", blocks: orphan.map(({ c, p }) => block(c, p)) });
  const [a, z] = dayRange(day, on.flatMap(({ p }) => [p.start, p.end]));
  return (
    <div className="space-y-2">
      <ConflictBar ctx={ctx} day={day} />
      <TimeGrid from={a} to={z} columns={columns} nowMin={day === ctx.now.day ? ctx.now.min : null} />
      <p className="text-xs text-muted">🟠 주황 선 = 지금 시각 (오늘 요일에서만, 1분마다 움직임) · 블록을 누르면 반 상세가 열려요.</p>
    </div>
  );
}

/* ------------------------------------------------------------ ② 교실별 */

export function RoomView({ ctx, day }: { ctx: Ctx; day: number }) {
  const confirm = useConfirm();
  const { classes, rooms, bookings, tempSwaps, alertOk, week, today } = ctx.data;
  const date = week.find((w) => w.day === day)?.date ?? today;
  const past = date < today;
  const colors = dayColors(classes, day);
  const on = classes.flatMap((c) => partsOn(c, day, isSwapped(tempSwaps, c.id, day)).map((p) => ({ c, p })));
  const dayBookings = bookings.filter((b) => b.date === date);
  const [alert, setAlert] = useState<{ key: string; text: string; className: string } | null>(null);
  const [memo, setMemo] = useState<{ roomId: number; roomName: string; start: number } | null>(null);
  const canBook = can(ctx.user, "rooms.booking");

  // 경고: 한 교실에 두 반이 겹침(SR룸 제외) · 교실 정원 초과
  const alerts = new Map<string, string>();
  for (const r of rooms) {
    const items = on.filter(({ p }) => p.roomId === r.id);
    for (const { c, p } of items) {
      const msgs: string[] = [];
      if (r.isSr !== 1 && items.some((o) => o.c.id !== c.id && overlaps(o.p.start, o.p.end, p.start, p.end))) msgs.push("2개반 배정");
      if (r.capacity && c.students.length > r.capacity) msgs.push(`인원초과 (${c.students.length}/${r.capacity}명)`);
      if (msgs.length) alerts.set(alertKey(day, r.name, p.start, c.name), msgs.join(" · "));
    }
  }
  const open = [...alerts.keys()].filter((k) => !alertOk.includes(k)).length;

  const cancelBooking = async (id: number, text: string) => {
    if (!canBook) return;
    const yes = await confirm({ title: "사용 취소할까요?", message: text, confirmText: "취소하기" });
    if (!yes) return;
    try {
      await apiDelete("/api/timetable/booking", { id });
      await ctx.reload();
    } catch (e) {
      ctx.setError(errorMessage(e));
    }
  };

  const columns: GridColumn[] = rooms.map((r) => ({
    key: `r${r.id}`,
    label: r.name,
    sub: r.capacity ? `정원 ${r.capacity}` : "",
    blocks: [
      ...on
        .filter(({ p }) => p.roomId === r.id)
        .map(({ c, p }) => {
          const key = alertKey(day, r.name, p.start, c.name);
          const a = alerts.get(key);
          const ok = alertOk.includes(key);
          const tag = a ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setAlert({ key, text: a, className: c.name });
              }}
              className={`mt-0.5 block w-fit rounded px-1 text-[10px] font-bold ${ok ? "border border-present bg-white text-present" : "bg-alert text-white"}`}
            >
              {ok ? "✓ 확인됨" : `⚠ 확인필요: ${a}`}
            </span>
          ) : null;
          return classBlock(c, p, colors.get(c.id), () => ctx.openClass(c.id), (
            <>
              {tag}
              {isSwapped(tempSwaps, c.id, day) ? <TempTag /> : null}
            </>
          ));
        }),
      ...dayBookings
        .filter((b) => b.roomId === r.id)
        .map<GridBlock>((b) => ({
          key: `b${b.id}`,
          start: b.start,
          end: b.end,
          kind: "booking",
          title: canBook ? "교실배정 — 누르면 취소" : "교실배정",
          onClick: canBook ? () => void cancelBooking(b.id, `${r.name} · ${rangeLabel(b.start, b.end)} · ${b.name}`) : undefined,
          content: (
            <>
              <b className="text-xs">📌 {b.name}</b>
              {b.headcount ? ` (${b.headcount}명)` : ""}
              <br />
              {rangeLabel(b.start, b.end)}
              {b.teacherName ? (
                <>
                  <br />👤 {b.teacherName}
                </>
              ) : null}
            </>
          ),
        })),
    ],
  }));
  const [a, z] = dayRange(day, [...on.flatMap(({ p }) => [p.start, p.end]), ...dayBookings.flatMap((b) => [b.start, b.end])]);

  // 사용 가능 교실 — 30분 단위
  const plain = rooms.filter((r) => r.isSr !== 1);
  const rowsHtml: ReactNode[] = [];
  for (let t = a; t < z; t += 30) {
    const nowRow = day === ctx.now.day && ctx.now.min >= t && ctx.now.min < t + 30;
    rowsHtml.push(
      <tr key={t} className={nowRow ? "outline outline-1 -outline-offset-1 outline-now" : ""}>
        <th className="border border-line bg-navy-50 px-1 py-0.5 text-center font-semibold text-muted">{fmtTime(t)}</th>
        {plain.map((r) => {
          const cls = on.find(({ p }) => p.roomId === r.id && overlaps(p.start, p.end, t, t + 30));
          if (cls) return <td key={r.id} className="border border-line bg-navy-50 px-1 py-0.5 text-center text-muted">{cls.c.name}</td>;
          const bk = dayBookings.find((b) => b.roomId === r.id && overlaps(b.start, b.end, t, t + 30));
          if (bk)
            return (
              <td
                key={r.id}
                title={bk.name}
                className={`border border-line bg-late-soft px-1 py-0.5 text-center font-bold text-late ${canBook ? "cursor-pointer" : ""}`}
                onClick={() => void cancelBooking(bk.id, `${r.name} · ${rangeLabel(bk.start, bk.end)} · ${bk.name}`)}
              >
                사용중
              </td>
            );
          const clickable = canBook && !past;
          return (
            <td
              key={r.id}
              className={`border border-line px-1 py-0.5 text-center text-present ${clickable ? "cursor-pointer hover:bg-present-soft" : ""}`}
              onClick={clickable ? () => setMemo({ roomId: r.id, roomName: r.name, start: t }) : undefined}
              title={past ? "지난 날이에요" : undefined}
            >
              가능
            </td>
          );
        })}
      </tr>,
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          ⚠ 경고: 한 교실에 두 반이 겹침(SR룸 제외) · 교실 정원 초과 — 확인하면 ✓ 로 바뀌고 다음 주에도 유지. 정원은 「계정 · 강의실」에서 넣어요.
        </span>
        {open ? <span className="rounded-full border border-alert px-2.5 py-0.5 text-xs font-bold text-alert">확인필요 {open}건</span> : null}
      </div>
      <TimeGrid from={a} to={z} columns={columns} nowMin={day === ctx.now.day ? ctx.now.min : null} />
      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <b>
            {DAY_LABELS[day]}요일 사용 가능 교실 <span className="text-xs font-normal text-muted">({date.slice(5).replace("-", "/")})</span>
          </b>
          <span className="text-xs text-muted">{canBook ? "「가능」을 누르면 메모와 함께 30분 사용 표시 · 「사용중」을 누르면 취소" : "교실배정은 관리자 · 데스크가 해요"}</span>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-line bg-navy-50 px-1 py-1 text-muted">시간</th>
              {plain.map((r) => (
                <th key={r.id} className="border border-line bg-navy-50 px-1 py-1 text-muted">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rowsHtml}</tbody>
        </table>
      </div>

      {alert ? <AlertModal ctx={ctx} alert={alert} onClose={() => setAlert(null)} /> : null}
      {memo ? <MemoModal ctx={ctx} date={date} memo={memo} onClose={() => setMemo(null)} /> : null}
    </div>
  );
}

function AlertModal({ ctx, alert, onClose }: { ctx: Ctx; alert: { key: string; text: string; className: string }; onClose: () => void }) {
  const done = ctx.data.alertOk.includes(alert.key);
  const [error, setError] = useState<string | null>(null);
  const set = async (on: boolean) => {
    try {
      await apiPost("/api/timetable/alert", { key: alert.key, on });
      await ctx.reload();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      title={done ? "✓ 확인됨" : "⚠ 확인필요"}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          {can(ctx.user, "rooms.alertOk") ? (
            done ? (
              <button type="button" className="btn" onClick={() => void set(false)}>
                되돌리기
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void set(true)}>
                확인 완료
              </button>
            )
          ) : null}
        </>
      }
    >
      <p className="text-sm">
        <b>{alert.className}</b> — {alert.text}
      </p>
      <p className="mt-2 text-xs text-muted">확인 완료하면 빨간 표시가 사라지고, 같은 요일·교실·시간이면 다음 주에도 확인된 상태로 남아요.</p>
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

function MemoModal({ ctx, date, memo, onClose }: { ctx: Ctx; date: string; memo: { roomId: number; roomName: string; start: number }; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!text.trim()) return setError("메모를 입력해 주세요.");
    try {
      await apiPost("/api/timetable/booking", { date, roomId: memo.roomId, start: memo.start, end: memo.start + 30, name: text.trim() });
      await ctx.reload();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      title={`${memo.roomName} · ${fmtTime(memo.start)} 사용`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            사용 표시
          </button>
        </>
      }
    >
      <label className="label">무엇에 쓰나요 (메모)</label>
      <input className="field" placeholder="예) 김서준 보강" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} autoFocus />
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------ ③ 전체 반 */

export function AllView({ ctx }: { ctx: Ctx }) {
  const confirm = useConfirm();
  const { classes, teachers, books } = ctx.data;
  const groups = [...GRADE_ORDER, ...[...new Set(classes.map((c) => c.grade || "개별"))].filter((g) => !GRADE_ORDER.includes(g))]
    .map((g) => [g, classes.filter((c) => (c.grade || "개별") === g)] as const)
    .filter(([, l]) => l.length);
  const colorOf = (id: number | null) => teacherColor(teachers.findIndex((t) => t.id === id));
  const del = async (c: ClassModel) => {
    const yes = await confirm({ title: "반을 삭제할까요?", message: `${c.name} 반과 시간표가 함께 지워져요.`, confirmText: "삭제", danger: true });
    if (!yes) return;
    try {
      await apiDelete("/api/classes", { id: c.id });
      await ctx.reload();
    } catch (e) {
      ctx.setError(errorMessage(e));
    }
  };
  return (
    <div>
      <div className="card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {teachers.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1.5 text-sm font-bold">
              <span className="h-3.5 w-3.5 rounded" style={{ background: colorOf(t.id) }} />
              {teacherLabel(t.name)}
            </span>
          ))}
        </span>
        <span className="text-xs text-muted">테두리 색 = 담당 선생님 · 순서: 초등피팅 · 초1~6 · 중등피팅 · 중1~3 · 고등피팅 · 고1~3 · 누적오답 · 숙제반 · 개별</span>
      </div>
      {groups.map(([g, list]) => (
        <section key={g}>
          <h3 className="mb-2.5 mt-5 text-[22px] font-extrabold text-navy-900">
            {g} {list.length}개 반
            {GRADE_ORDER.includes(g) ? null : <span className="ml-2 text-sm font-semibold text-muted">{levelOf(list[0])}</span>}
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
            {list.map((c) => {
              const t = mainTeacher(c);
              const col = colorOf(t.id);
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => ctx.openClass(c.id)}
                  className="card relative cursor-pointer px-4 py-3.5 hover:shadow-md"
                  style={{ borderColor: col, borderWidth: 2, borderLeftWidth: 7 }}
                >
                  <div className="mb-1.5 text-[22px] font-extrabold">{c.name}</div>
                  <div className="text-[15px] leading-7">
                    {dayLabel(c.days)} {timeSpan(c)}
                  </div>
                  <div className="text-[15px] leading-7">
                    <span className="mr-1 text-muted">학습과정</span> {course(c, books) || "—"}
                  </div>
                  <div className="text-[15px] leading-7">
                    <span className="mr-1 text-muted">인원</span> {c.students.length}명
                  </div>
                  <div className="text-[15px] leading-7">
                    <span className="mr-1 text-muted">담당</span>{" "}
                    <b style={{ color: col }}>{teacherLabel(t.name)}</b>
                  </div>
                  {can(ctx.user, "timetable.write") ? (
                    <button
                      type="button"
                      className="btn btn-danger absolute bottom-3 right-3 px-2 py-0.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        void del(c);
                      }}
                    >
                      삭제
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ ④ 학생 찾기 */

/** 요일별 칸 표 — withSeat 면 SR 자리 칸도 */
export function DayTable({ ctx, c, studentId, onEditBooks }: { ctx: Ctx; c: ClassModel; studentId?: number; onEditBooks?: (p: ClassPart) => void }) {
  const TINT = ["bg-alert-soft", "bg-present-soft", "bg-late-soft", "bg-ok-soft", "bg-navy-50", "bg-srpink-soft", "bg-navy-100"];
  const seat = studentId ? ctx.data.seats.find((s) => s.classId === c.id && s.studentId === studentId)?.seat ?? null : null;
  const rows = c.days.flatMap((d) =>
    partsOn(c, d).map((p, i, arr) => (
      <tr key={`${d}-${p.kind}-${p.start}`} className={TINT[d]}>
        {i === 0 ? (
          <td rowSpan={arr.length} className="border-b border-line px-2.5 py-2 font-extrabold">
            {DAY_LABELS[d]}
          </td>
        ) : null}
        <td className="border-b border-line px-2.5 py-2">{rangeLabel(p.start, p.end)}</td>
        <td className="border-b border-line px-2.5 py-2">{p.label}</td>
        <td className="border-b border-line px-2.5 py-2">
          {partBooks(p, ctx.data.books) || "—"}
          {onEditBooks && p.kind === "CLASS" && can(ctx.user, "books.write") ? (
            <button type="button" className="btn ml-1 px-1.5 py-0 text-xs" title="사용교재 입력" onClick={() => onEditBooks(p)}>
              ✏️
            </button>
          ) : null}
        </td>
        <td className="border-b border-line px-2.5 py-2">{p.roomName ?? "—"}</td>
        <td className="border-b border-line px-2.5 py-2">{p.kind === "SR" ? "—" : teacherLabel(p.teacherName)}</td>
        {studentId ? <td className="border-b border-line px-2.5 py-2 font-bold">{p.kind === "SR" ? seat ?? "—" : ""}</td> : null}
      </tr>
    )),
  );
  return (
    <table className="mt-1 w-full border-collapse text-sm">
      <thead>
        <tr className="bg-navy-50 text-left text-xs text-muted">
          <th className="px-2.5 py-2">요일</th>
          <th className="px-2.5 py-2">시간</th>
          <th className="px-2.5 py-2">과정구분</th>
          <th className="px-2.5 py-2">사용교재</th>
          <th className="px-2.5 py-2">강의실</th>
          <th className="px-2.5 py-2">담당</th>
          {studentId ? <th className="px-2.5 py-2">SR 자리</th> : null}
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

export function SearchView({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState("");
  const [bookFor, setBookFor] = useState<{ c: ClassModel; p: ClassPart } | null>(null);
  const { classes, tempSwaps } = ctx.data;
  const students = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of classes) for (const s of c.students) m.set(s.id, s.name);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [classes]);
  const query = q.trim();
  const exact = students.filter((s) => s.name === query);
  const found = query ? (exact.length ? exact : students.filter((s) => s.name.includes(query))).slice(0, 5) : [];
  return (
    <div className="space-y-3">
      <div className="card flex items-center gap-2 p-3.5">
        <input className="field w-72" list="tt-students" placeholder="학생 이름" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <datalist id="tt-students">
          {students.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <span className="text-xs text-muted">지금 어디 있는지 + SR 자리</span>
      </div>
      {!query ? <p className="text-sm text-muted">이름을 입력하세요.</p> : found.length === 0 ? <p className="text-sm text-muted">찾는 학생이 없어요.</p> : null}
      {found.map((st) => {
        const mine = classes.filter((c) => c.students.some((s) => s.id === st.id));
        let live: { c: ClassModel; p: ClassPart } | null = null;
        for (const c of mine)
          for (const p of partsOn(c, ctx.now.day, isSwapped(tempSwaps, c.id, ctx.now.day)))
            if (p.start <= ctx.now.min && ctx.now.min < p.end) live = { c, p };
        const seat = live ? ctx.data.seats.find((s) => s.classId === live!.c.id && s.studentId === st.id)?.seat : null;
        return (
          <div key={st.id} className="card p-4">
            <h3 className="text-lg font-bold">
              {st.name} <span className="text-sm font-semibold text-muted">{mine.map((c) => c.name).join(" · ")}</span>
            </h3>
            {live ? (
              <div className="my-2.5 rounded-xl border border-ok-soft bg-ok-soft px-3.5 py-3 font-bold text-ok">
                🟢 지금 {live.c.name} {live.p.label} 중 —{" "}
                {live.p.kind === "SR" ? (
                  <>
                    SR룸 <b>{seat ?? "자리 없음"}</b> 자리
                  </>
                ) : (
                  `담당 ${teacherLabel(live.p.teacherName)} · 강의실 ${live.p.roomName ?? "—"}`
                )}{" "}
                ({rangeLabel(live.p.start, live.p.end)})
              </div>
            ) : (
              <div className="my-2.5 rounded-xl border border-line bg-navy-50 px-3.5 py-3 font-bold text-muted">
                ⚪ 지금({DAY_LABELS[ctx.now.day]} {fmtTime(ctx.now.min)})은 수업 시간이 아니에요.
              </div>
            )}
            {mine.map((c) => (
              <div key={c.id} className="mt-2.5">
                <b>{c.name}</b>
                <DayTable ctx={ctx} c={c} studentId={st.id} onEditBooks={(p) => setBookFor({ c, p })} />
              </div>
            ))}
          </div>
        );
      })}
      {bookFor ? <PartBooksModal ctx={ctx} c={bookFor.c} p={bookFor.p} onClose={() => setBookFor(null)} /> : null}
    </div>
  );
}

/** 사용교재 입력 — 「초등 5-1 심화」 처럼 (그 칸의 모든 요일에 적용). 책장에 없으면 새로 들어간다 */
export function PartBooksModal({ ctx, c, p, onClose }: { ctx: Ctx; c: ClassModel; p: ClassPart; onClose: () => void }) {
  const [ids, setIds] = useState<number[]>(p.bookIds);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [extra, setExtra] = useState(ctx.data.books);
  const save = async (next: number[]) => {
    setError(null);
    try {
      await apiPost("/api/timetable/books", { classId: c.id, days: p.days, bookIds: next });
      setIds(next);
      await ctx.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const add = async () => {
    if (!text.trim()) return;
    try {
      const { id } = await apiPost<{ id: number }>("/api/books", { text });
      setText("");
      setExtra((await apiGet<{ books: Book[] }>("/api/books")).books);
      if (!ids.includes(id)) await save([...ids, id]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      title="사용교재 입력"
      subtitle={`${c.name} · ${p.label} ${dayLabel(p.days)} ${rangeLabel(p.start, p.end)}`}
      onClose={onClose}
      width={520}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          닫기
        </button>
      }
    >
      <div className="flex flex-wrap gap-1">
        {ids.length === 0 ? <span className="text-sm text-muted">아직 없어요</span> : null}
        {ids.map((id) => {
          const b = extra.find((x) => x.id === id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border border-line bg-navy-50 px-2 py-0.5 text-xs">
              {b ? `${b.grade} ${b.name}` : id}
              <button type="button" className="text-muted" onClick={() => void save(ids.filter((x) => x !== id))}>
                ✕
              </button>
            </span>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="field" list="tt-books" placeholder="예) 초등 5-1 심화" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <datalist id="tt-books">
          {extra.map((b) => (
            <option key={b.id} value={`${b.level} ${b.grade} ${b.name}`} />
          ))}
        </datalist>
        <button type="button" className="btn" onClick={() => void add()}>
          넣기
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        과정 + 교재 이름으로 입력해요: <b>초등 5-1 심화</b> · <b>중등 1-1 데메테르</b> · <b>고등 공통수학2 입</b>. 책장에 없으면 새로 들어가요.
      </p>
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------ ⑤ 반 관리 */

export function ManageView({ ctx }: { ctx: Ctx }) {
  const confirm = useConfirm();
  const del = async (c: ClassModel) => {
    const yes = await confirm({ title: "반을 삭제할까요?", message: `${c.name} 반과 시간표가 함께 지워져요.`, confirmText: "삭제", danger: true });
    if (!yes) return;
    try {
      await apiDelete("/api/classes", { id: c.id });
      await ctx.reload();
    } catch (e) {
      ctx.setError(errorMessage(e));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          한 반 안에 <b>여러 칸</b>(수업 · SR)을 두고, 칸마다 요일을 다르게 정할 수 있어요.
        </span>
        <button type="button" className="btn btn-primary" onClick={() => ctx.editClass(null)}>
          ＋ 새 반 추가
        </button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-50 text-left text-xs text-muted">
              {["반 이름", "학년", "요일", "시간", "칸", "학생 수", "담당", ""].map((h) => (
                <th key={h} className="px-3 py-2.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ctx.data.classes.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-3 py-2 font-bold">{c.name}</td>
                <td className="px-3 py-2">{c.grade}</td>
                <td className="px-3 py-2">{dayLabel(c.days)}</td>
                <td className="px-3 py-2">{timeSpan(c)}</td>
                <td className="px-3 py-2">
                  {c.parts.map((p) => (
                    <span key={`${p.kind}-${p.start}-${p.days.join()}`} className="mr-1 rounded bg-navy-50 px-1.5 py-px text-[11px] font-bold">
                      {p.label}
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2">{c.students.length}</td>
                <td className="px-3 py-2">{teacherLabel(mainTeacher(c).name)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => ctx.editClass(c.id)}>
                    편집
                  </button>{" "}
                  <button type="button" className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => void del(c)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
