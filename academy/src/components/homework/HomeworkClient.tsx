"use client";

// 숙제 관리 — ① 숙제검사 (반별 표: 학생 × 수업 날짜 + 금·토 개별) ② 숙제반 현황 (월 단위).
// 빈칸 = 숙제 완료. 카운트 2가 되는 날 = 강제 숙제반 시작, 그 뒤 SR 숙제검사 4번 연속 완료면 졸업. 분기마다 0부터.
// 숙제검사는 초중등만(고등부 안 함). 선생님은 내 반만 기입.

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import { TrashButton, usePurge } from "../Purge";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { can } from "@/lib/perm";
import {
  MARKS,
  MARK_LIST,
  addDays,
  applyLabel,
  certIssues,
  certUnchecked,
  clashOn,
  datesBetween,
  defaultPlan,
  dowOf,
  md,
  monthDates,
  partNo,
  quarterOf,
  timeline,
  type Cycle,
  type HwPlan,
  type HwSlot,
  type Mark,
  type Timeline,
} from "@/lib/homework";
import { DAY_LABELS, rangeLabel } from "@/lib/time";
import { hasRole, teacherLabel, type SessionUser } from "@/lib/types";
import type { HomeworkData } from "@/lib/repo/homework";
import type { PurgeKey } from "@/lib/repo/purge";

type Student = HomeworkData["students"][number];
type Act = (body: Record<string, unknown>, ok?: string) => Promise<unknown>;
/** 🗑 관리자 — 기록 지우기 (없으면 버튼을 안 보인다) */
type Purge = ((keys: PurgeKey[]) => Promise<void>) | undefined;

/** 표시 색 — 시트와 같게 */
const MARK_CLS: Record<Mark, string> = {
  숙제미흡: "bg-hw-miss text-hw-miss-ink",
  "준비물 미지참": "bg-hw-prep text-hw-prep-ink",
  "숙제+준비물 미흡": "bg-hw-both text-hw-both-ink",
  숙제불량: "bg-hw-bad text-white",
  결석: "bg-hw-absent text-hw-absent-ink",
};
const GRADE_SORT = ["초등피팅", "초4", "초5", "초6", "중등피팅", "중1", "중2", "중3"];
const mdw = (s: string) => `${md(s)}(${DAY_LABELS[dowOf(s)]})`;
/** 「1부 초등숙제반 시간 오후 4:00 ~ 6:00」 */
const slotLabel = (slots: HwSlot[], s: HwSlot) => `${partNo(slots, s)}부 ${s.name} ${rangeLabel(s.start, s.end)}`;
const HW_DAYS = [1, 2, 3, 4];

export default function HomeworkClient({ user, initialView }: { user: SessionUser; initialView?: string }) {
  const [data, setData] = useState<HomeworkData | null>(null);
  const [view, setView] = useState<"check" | "class">(initialView === "class" ? "class" : "check");
  const [group, setGroup] = useState<"월수" | "화목">(() => ([2, 4].includes(new Date().getDay()) ? "화목" : "월수"));
  const [month, setMonth] = useState<string>("");
  const [mine, setMine] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "plan" | "late" | "apply" | "form"; studentId?: number; lateId?: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<HomeworkData>("/api/homework");
      setData(d);
      setMonth((m) => m || d.today.slice(0, 7));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const act: Act = async (body, ok) => {
    setError(null);
    try {
      const res = await apiPost<unknown>("/api/homework", body);
      await load();
      if (ok) setToast(ok);
      return res ?? true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  const purge = usePurge();
  const doPurge: Purge = can(user, "records.purge")
    ? async (keys) => {
        setError(null);
        try {
          if (await purge(keys)) {
            await load();
            setToast("기록을 지웠어요");
          }
        } catch (e) {
          setError(errorMessage(e));
        }
      }
    : undefined;

  const h = useHelpers(data);
  const months = useMemo(() => {
    if (!data) return [];
    const q = quarterOf(data.today);
    const prev = quarterOf(addDays(q.start, -1));
    const out: string[] = [];
    for (let d = prev.start; d <= q.end; d = addDays(d, 32).slice(0, 8) + "01") out.push(d.slice(0, 7));
    return [...new Set(out)];
  }, [data]);

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["check", "숙제검사"],
              ["class", "숙제반 현황"],
            ] as const
          ).map(([k, n]) => (
            <button key={k} type="button" className={`btn ${view === k ? "btn-primary" : ""}`} onClick={() => setView(k)}>
              {n}
            </button>
          ))}
        </div>
        {view === "class" && can(user, "homework.class") ? (
          <div className="flex gap-1.5">
            <button type="button" className="btn" onClick={() => setModal({ kind: "apply" })}>
              🙋 신청 등록
            </button>
            <button type="button" className="btn" onClick={() => setModal({ kind: "form" })}>
              🔄 설문 응답 불러오기
            </button>
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-semibold text-alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setError(null)}>
            닫기
          </button>
        </div>
      ) : null}
      {!data || !h ? (
        <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : view === "check" ? (
        <CheckView user={user} data={data} h={h} group={group} setGroup={setGroup} month={month} setMonth={setMonth} months={months} mine={mine} setMine={setMine} act={act} setToast={setToast} purge={doPurge} />
      ) : (
        <ClassView user={user} data={data} h={h} month={month} setMonth={setMonth} months={months} act={act} open={setModal} purge={doPurge} />
      )}
      {data && h && modal?.kind === "plan" && modal.studentId ? <PlanModal data={data} h={h} studentId={modal.studentId} act={act} onClose={() => setModal(null)} /> : null}
      {data && h && modal?.kind === "late" && modal.lateId ? <LateModal data={data} h={h} lateId={modal.lateId} act={act} onClose={() => setModal(null)} /> : null}
      {data && h && modal?.kind === "apply" ? <ApplyModal data={data} h={h} months={months} studentId={modal.studentId} month={month} act={act} onClose={() => setModal(null)} onMonth={setMonth} /> : null}
      {data && modal?.kind === "form" ? <FormModal data={data} month={month} months={months} act={act} onClose={() => setModal(null)} /> : null}
      {toast ? <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white">{toast}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------ 계산 도우미 */

type Helpers = ReturnType<typeof makeHelpers>;
function useHelpers(data: HomeworkData | null) {
  return useMemo(() => (data ? makeHelpers(data) : null), [data]);
}

function makeHelpers(data: HomeworkData) {
  const today = data.today;
  const marks = new Map<number, Map<string, Mark>>();
  for (const m of data.marks) {
    const x = marks.get(m.studentId) ?? new Map<string, Mark>();
    x.set(m.date, m.mark);
    marks.set(m.studentId, x);
  }
  const cert = new Map<number, Map<string, "OK" | "MISS">>();
  for (const c of data.cert) {
    const x = cert.get(c.studentId) ?? new Map<string, "OK" | "MISS">();
    x.set(c.date, c.state);
    cert.set(c.studentId, x);
  }
  const student = (id: number) => data.students.find((s) => s.id === id);
  const checkDates = (st: Student, from: string, to: string) => {
    const days = new Set([...(st.regular?.days ?? []), ...st.individualDays]);
    return datesBetween(from, to).filter((d) => days.has(dowOf(d)));
  };
  const tlCache = new Map<string, Timeline>();
  /** 그 달이 속한 분기의 흐름 (오늘까지) */
  const tl = (st: Student, ym = today.slice(0, 7)): Timeline => {
    const key = `${st.id}|${ym}`;
    const hit = tlCache.get(key);
    if (hit) return hit;
    const q = quarterOf(`${ym}-01`);
    const to = q.end < today ? q.end : today;
    const t = timeline(marks.get(st.id) ?? new Map(), checkDates(st, q.start, to), q.start, to);
    tlCache.set(key, t);
    return t;
  };
  const busy = (st: Student) => (d: number) => (st.busy[d] ?? []) as [number, number][];
  /** 그 달 신청 — 요일마다 1부 · 2부 */
  const applyOf = (studentId: number, ym: string) => data.apply.filter((a) => a.studentId === studentId && a.month === ym);
  const planOf = (st: Student): HwPlan => {
    const rows = data.plans.filter((p) => p.studentId === st.id);
    if (!rows.length)
      return defaultPlan(data.slots, { applying: applyOf(st.id, today.slice(0, 7)), regularDays: st.regular?.days ?? [], busy: busy(st), level: st.regular?.level ?? null });
    const p: HwPlan = {};
    for (const r of rows) p[r.day] = r.how === "CERT" ? { how: "CERT" } : { how: "ATTEND", slotId: r.slotId ?? 0 };
    return p;
  };
  const planLabel = (p: HwPlan) => {
    const by = (how: "ATTEND" | "CERT") =>
      Object.entries(p)
        .filter(([, v]) => v?.how === how)
        .map(([d]) => DAY_LABELS[Number(d)])
        .join("");
    return [by("ATTEND") && `${by("ATTEND")} 🏫`, by("CERT") && `${by("CERT")} 📷`].filter(Boolean).join(" · ") || "—";
  };
  const issues = (st: Student, c: Cycle, ym: string) => certIssues(cert.get(st.id) ?? new Map(), c, ym);
  /** 📷 확인 안 한 인증 날 (어제까지) */
  const unchecked = (st: Student, c: Cycle) => certUnchecked(planOf(st), c, cert.get(st.id) ?? new Map(), today);
  return { today, marks, cert, student, tl, busy, planOf, planLabel, issues, applyOf, unchecked };
}

const Legend = () => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    {MARK_LIST.map((k) => (
      <span key={k} className={`rounded px-2 py-0.5 text-xs font-bold ${MARK_CLS[k]}`}>
        {k}
        {MARKS[k].score ? ` ${MARKS[k].score}` : " (검사 없음)"}
      </span>
    ))}
  </span>
);

/* ------------------------------------------------------------ ① 숙제검사 */

function CheckView({
  user,
  data,
  h,
  group,
  setGroup,
  month,
  setMonth,
  months,
  mine,
  setMine,
  act,
  setToast,
  purge,
}: {
  purge: Purge;
  user: SessionUser;
  data: HomeworkData;
  h: Helpers;
  group: "월수" | "화목";
  setGroup: (g: "월수" | "화목") => void;
  month: string;
  setMonth: (m: string) => void;
  months: string[];
  mine: boolean;
  setMine: (v: boolean) => void;
  act: Act;
  setToast: (m: string) => void;
}) {
  const teacherOnly = hasRole(user, "TEACHER") && !hasRole(user, "ADMIN") && !hasRole(user, "DESK");
  const mineOnly = teacherOnly || (hasRole(user, "TEACHER") && mine);
  const all = monthDates(month);
  const regDays = group === "월수" ? [1, 3] : [2, 4];
  const regDates = all.filter((d) => regDays.includes(dowOf(d)));
  const indDates = all.filter((d) => dowOf(d) === 5 || dowOf(d) === 6);
  const classes = data.classes
    .filter((c) => c.group === group && (!mineOnly || c.teacherId === user.id))
    .sort((a, b) => GRADE_SORT.indexOf(a.grade ?? "") - GRADE_SORT.indexOf(b.grade ?? "") || a.name.localeCompare(b.name));
  const members = (classId: number) => data.students.filter((s) => s.regular?.id === classId);
  const warn = classes.flatMap((c) => members(c.id)).filter((s) => {
    const t = h.tl(s, month);
    return !t.cur && t.count >= 1.5;
  });
  const canEdit = (st: Student) =>
    can(user, "homework.check") && (hasRole(user, "ADMIN") || hasRole(user, "DESK") || st.teacherName === user.name || st.regular?.teacherId === user.id);

  const setMark = async (st: Student, date: string, mark: string) => {
    const res = (await act({ action: "MARK", studentId: st.id, date, mark: mark || null })) as { started?: boolean; graduated?: boolean } | false;
    if (res && res.started) setToast(`⚠ ${st.name} 카운트 2 — 강제 숙제반 자동 등록 · ${teacherLabel(st.teacherName)} 알림`);
    else if (res && res.graduated) setToast(`🎓 ${st.name} 4연속 성공 — 숙제반 졸업, 카운트 0부터`);
  };

  const W = 58;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-present-soft bg-present-soft px-4 py-2.5 text-[13px] text-navy-800">
        <span>
          빈칸 = 숙제 완료 · 카운트 <b>2가 되는 순간 강제 숙제반</b> 자동 등록 · 초중등만 ·{" "}
          <b>
            {quarterOf(`${month}-01`).label}({Number(quarterOf(`${month}-01`).start.slice(5, 7))}~{Number(quarterOf(`${month}-01`).end.slice(5, 7))}월) 누적
          </b>{" "}
          — 카운트 · 지각은 다음 분기로 넘어가지 않고 0부터
        </span>
        <Legend />
      </div>
      {warn.length ? <div className="rounded-xl border border-late bg-late-soft px-4 py-2.5 text-[13px] font-bold text-late">🟠 1.5 — 한 번 더 미흡하면 숙제반: {warn.map((s) => s.name).join(", ")}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["월수", "화목"] as const).map((g) => (
            <button key={g} type="button" className={`btn ${group === g ? "btn-primary" : ""}`} onClick={() => setGroup(g)}>
              {g} + 개별
            </button>
          ))}
          <select className="field w-24" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {Number(m.slice(5))}월
              </option>
            ))}
          </select>
        </div>
        {hasRole(user, "TEACHER") && !teacherOnly ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내 반만
          </label>
        ) : teacherOnly ? (
          <span className="text-xs text-muted">선생님은 내 반만 보여요</span>
        ) : null}
      </div>
      {classes.length === 0 ? <p className="text-sm text-muted">볼 수 있는 반이 없어요.</p> : null}
      {classes.map((c) => (
        <div key={c.id}>
          <div className="mb-1 mt-3 text-[15px] font-extrabold text-navy-900">
            {c.name} <span className="text-xs font-semibold text-muted">{teacherLabel(c.teacherName)} · {members(c.id).length}명</span>
          </div>
          <div className="overflow-auto">
            <table className="table-fixed border-collapse bg-white text-xs">
              <colgroup>
                <col style={{ width: 170 }} />
                <col style={{ width: 104 }} />
                {[...regDates, ...indDates].map((d) => (
                  <col key={d} style={{ width: W }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="h-7 border border-line bg-navy-50 text-muted">이름 · 카운트</th>
                  <th className="border border-line bg-navy-50 text-muted">교재</th>
                  {regDates.map((d) => (
                    <th key={d} className="border border-line bg-navy-50 text-muted">
                      {md(d)}
                    </th>
                  ))}
                  {indDates.map((d) => (
                    <th key={d} className="border border-line bg-late-soft text-muted">
                      {md(d)} {DAY_LABELS[dowOf(d)]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members(c.id).map((st) => {
                  const t = h.tl(st, month);
                  const cell = (d: string, ind: boolean) => {
                    const v = h.marks.get(st.id)?.get(d) ?? "";
                    const off = ind && !st.individualDays.includes(dowOf(d)) && !v;
                    if (off) return <td key={d} className="h-7 border border-line bg-navy-50" />;
                    const edit = canEdit(st) && d <= data.today;
                    return (
                      <td
                        key={d}
                        title={v}
                        className={`h-7 border border-line p-0 text-center ${v ? MARK_CLS[v as Mark] : ind ? "bg-late-soft" : ""} ${d === data.today ? "outline outline-2 -outline-offset-2 outline-now" : ""}`}
                      >
                        <select
                          disabled={!edit}
                          value={v}
                          className="h-7 w-full cursor-pointer appearance-none bg-transparent text-center text-[11px] font-bold text-inherit disabled:cursor-default"
                          onChange={(e) => void setMark(st, d, e.target.value)}
                        >
                          <option value="" />
                          {MARK_LIST.map((k) => (
                            <option key={k} value={k}>
                              {MARKS[k].short}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  };
                  // 🗑 이 달 숙제 표시 · 📷 인증 (관리자)
                  const monthKeys: PurgeKey[] = [
                    ...[...(h.marks.get(st.id) ?? new Map<string, Mark>()).keys()].filter((d) => d.startsWith(month)).map((d) => ({ kind: "HW_MARK" as const, studentId: st.id, date: d })),
                    ...[...(h.cert.get(st.id) ?? new Map<string, "OK" | "MISS">()).keys()].filter((d) => d.startsWith(month)).map((d) => ({ kind: "HW_CERT" as const, studentId: st.id, date: d })),
                  ];
                  return (
                    <tr key={st.id}>
                      <td className="h-7 truncate border border-line px-1.5 text-[13px] font-bold">
                        {purge && monthKeys.length ? (
                          <span className="mr-1">
                            <TrashButton title={`${Number(month.slice(5))}월 숙제 표시 · 📷 인증 지우기 (관리자)`} onClick={() => void purge(monthKeys)} />
                          </span>
                        ) : null}
                        {st.name}
                        <span className={`ml-1 inline-block min-w-[30px] rounded-md px-1 text-center font-extrabold ${t.count >= 2 ? "bg-alert-soft text-alert" : t.count >= 1.5 ? "bg-late-soft text-late" : "bg-navy-50"}`}>{t.count}</span>
                        {t.cur ? <span className="ml-1 rounded bg-alert-soft px-1 text-[11px] font-extrabold text-alert" title="강제 숙제반 — 연속 성공">숙제반 {t.cur.streak}/4</span> : null}
                      </td>
                      <td className="truncate border border-line px-1.5 text-muted">{st.textbook ?? ""}</td>
                      {regDates.map((d) => cell(d, false))}
                      {indDates.map((d) => cell(d, true))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="text-xs text-muted">주황 테두리 = 오늘 · 연한 주황 칸 = 개별반(금/토) 날짜 · 회색 = 그날 개별반 없음</p>
    </>
  );
}

/* ------------------------------------------------------------ ② 숙제반 현황 */

function ClassView({
  user,
  data,
  h,
  month,
  setMonth,
  months,
  act,
  open,
  purge,
}: {
  purge: Purge;
  user: SessionUser;
  data: HomeworkData;
  h: Helpers;
  month: string;
  setMonth: (m: string) => void;
  months: string[];
  act: Act;
  open: (m: { kind: "plan" | "late" | "apply"; studentId?: number; lateId?: number }) => void;
}) {
  const edit = can(user, "homework.class");
  /** 📷 인증 확인 — 담당T(내 반) · 관리자 · 데스크 */
  const certEdit = (st: Student) =>
    can(user, "homework.cert") && (hasRole(user, "ADMIN") || hasRole(user, "DESK") || st.regular?.teacherId === user.id);
  const days = monthDates(month);
  const end = days[days.length - 1];
  const rows: { st: Student; c: Cycle; i: number; total: number }[] = [];
  for (const st of data.students.filter((s) => s.regular)) {
    const t = h.tl(st, month);
    t.cycles.forEach((c, i) => {
      if (c.start <= end && (c.gradAt ?? "9999") >= days[0]) rows.push({ st, c, i, total: t.cycles.length });
    });
  }
  rows.sort((a, b) => Number(!!a.c.gradAt) - Number(!!b.c.gradAt) || a.c.start.localeCompare(b.c.start));
  const seen = (st: Student, start: string) => data.seen.some((s) => s.studentId === st.id && s.start === start);
  const newForced = rows.filter((r) => !r.c.gradAt && r.c.start >= addDays(data.today, -7) && !seen(r.st, r.c.start));
  const lateTodo = data.late.filter((l) => !l.done && !l.date);
  // 지각 「횟수」는 분기마다 0부터지만, 3회를 채워 이미 생긴 숙제반 1회는 다음 분기로 넘어간다
  const qStart = quarterOf(data.today).start;
  const carried = (l: { lates: string[]; done: boolean }) =>
    !l.done && l.lates.length > 0 && l.lates[l.lates.length - 1] < qStart ? (
      <span className="ml-1 rounded bg-navy-100 px-1 text-[11px] font-extrabold text-navy-800">지난 분기에서 넘어옴</span>
    ) : null;
  const misuse = rows.filter((r) => !r.c.gradAt).map((r) => ({ ...r, issues: h.issues(r.st, r.c, month) })).filter((r) => r.issues.length);
  // 📷 확인 안 한 인증 — 내가 확인할 수 있는 학생만 (선생님 = 내 반)
  const certTodo = rows
    .filter((r) => !r.c.gradAt && certEdit(r.st))
    .map((r) => ({ ...r, miss: h.unchecked(r.st, r.c) }))
    .filter((r) => r.miss.length);
  const name = (id: number) => data.students.find((s) => s.id === id)?.name ?? "";
  const tag = "inline-block rounded-md px-1.5 py-px text-xs font-extrabold mr-1";

  return (
    <>
      {newForced.length || lateTodo.length || misuse.length || certTodo.length ? (
        <div className="card px-4 py-2.5">
          <b>🔔 할 일</b>
          {certTodo.map((r) => (
            <div key={`c${r.st.id}`} className="mt-1.5 rounded-lg border border-alert px-3 py-1.5 text-[13px]">
              <span className={`${tag} bg-alert-soft text-alert`}>📷 확인</span>
              <b>{r.st.name}</b>({r.st.regular?.name}) {r.miss.map(mdw).join(", ")} 인증 확인 안 됨 →{" "}
              <b>아래 표 📷? 칸을 눌러 인증됨 / 미인증</b> <span className="text-muted">· {teacherLabel(r.st.teacherName)}</span>
            </div>
          ))}
          {newForced.map((r) => {
            return (
              <div key={`${r.st.id}-${r.c.start}`} className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]">
                <span>
                  <span className={`${tag} bg-alert-soft text-alert`}>강제</span>
                  <b>{r.st.name}</b>({r.st.regular?.name}) {md(r.c.start)} 카운트 {r.c.startCount} → 자동 등록 · <b>{h.planLabel(h.planOf(r.st))}</b>{" "}
                  <span className="text-muted">· {teacherLabel(r.st.teacherName)} 알림 보냄</span>
                </span>
                {edit ? (
                  <span className="flex gap-1">
                    <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => open({ kind: "plan", studentId: r.st.id })}>
                      요일 바꾸기
                    </button>
                    <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => void act({ action: "SEEN", studentId: r.st.id, start: r.c.start })}>
                      확인
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
          {lateTodo.map((l) => (
            <div key={l.id} className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]">
              <span>
                <span className={`${tag} bg-late-soft text-late`}>지각</span>
                <b>{name(l.studentId)}</b> 지각 3회 ({l.lates.map(md).join(", ")}) → 숙제반 1회 · <b className="text-alert">날짜 정하기</b>
                {carried(l)}
              </span>
              {edit ? (
                <button type="button" className="btn btn-primary px-2 py-0.5 text-xs" onClick={() => open({ kind: "late", lateId: l.id })}>
                  날짜 정하기
                </button>
              ) : null}
            </div>
          ))}
          {misuse.map((r) => (
            <div key={`m${r.st.id}`} className="mt-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px]">
              <span className={`${tag} ${r.issues.length >= 2 ? "bg-alert-soft text-alert" : "bg-late-soft text-late"}`}>인증</span>
              <b>{r.st.name}</b> {r.issues.map((x) => `${md(x.d)} ${x.why}`).join(" · ")} →{" "}
              {r.issues.length >= 2 ? (
                <b className="text-alert">⛔ 이번 달 인증 불가 — 남은 인증 요일은 숙제반 참석 (🏫!)</b>
              ) : (
                <b className="text-late">⚠ 경고 1회 — 한 번 더면 이번 달 인증 불가</b>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {months.map((m) => (
            <button key={m} type="button" className={`btn ${month === m ? "btn-primary" : ""}`} onClick={() => setMonth(m)}>
              {Number(m.slice(5))}월
            </button>
          ))}
        </div>
        <span className="flex flex-wrap gap-1 text-xs">
          <span className="rounded bg-ok-soft px-1.5 font-bold text-ok">✓ SR 검사 완료</span>
          <span className={`rounded px-1.5 font-bold ${MARK_CLS["숙제미흡"]}`}>✗ 미흡(색 = 종류)</span>
          <span className={`rounded px-1.5 font-bold ${MARK_CLS["결석"]}`}>결 = 결석</span>
          <span className="rounded bg-present-soft px-1.5 font-bold text-navy-800">🏫 숙제반 참석</span>
          <span className="rounded border border-line px-1.5 font-bold">📷 인증됨</span>
          <span className={`rounded px-1.5 font-bold ${MARK_CLS["숙제미흡"]}`}>📷? 확인 필요</span>
          <span className={`rounded px-1.5 font-bold ${MARK_CLS["숙제불량"]}`}>📷✗ 미인증</span>
          <span className="rounded bg-present-soft px-1.5 font-bold text-navy-800">🏫! 인증 불가 → 참석</span>
        </span>
      </div>

      <div className="card px-3 py-2.5">
        <b className="text-[15px]">⚠ 강제 숙제반 — {Number(month.slice(5))}월</b>{" "}
        <span className="text-xs text-muted">
          카운트 2가 된 날 시작 → 그 뒤 SR 숙제검사 <b>4번 연속 완료</b>면 졸업 (미흡이면 0부터 · 결석은 건너뜀). 숙제검사 표와 자동으로 이어져요.
        </span>
        <div className="mt-2 overflow-auto">
          <table className="table-fixed border-collapse bg-white text-[11px]">
            <colgroup>
              <col style={{ width: 220 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 96 }} />
              {days.map((d) => (
                <col key={d} style={{ width: 30 }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="h-[30px] border border-line bg-navy-50 text-muted">학생</th>
                <th className="border border-line bg-navy-50 text-muted">숙제반 요일</th>
                <th className="border border-line bg-navy-50 text-muted">연속 성공</th>
                {days.map((d) => (
                  <th key={d} className={`border border-line bg-navy-50 leading-tight ${dowOf(d) === 0 ? "text-alert" : "text-muted"}`}>
                    {Number(d.slice(8))}
                    <br />
                    {DAY_LABELS[dowOf(d)]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 3} className="h-10 border border-line text-center text-muted">
                    이 달에는 강제 숙제반 학생이 없어요.
                  </td>
                </tr>
              ) : null}
              {rows.map(({ st, c, i, total }) => {
                const plan = h.planOf(st);
                const iss = h.issues(st, c, month);
                const blockedFrom = iss[1]?.d; // 2번째 문제가 난 날 뒤로는 인증 불가
                const applying = data.apply.some((a) => a.studentId === st.id && a.month === month);
                return (
                  <tr key={`${st.id}-${c.start}`}>
                    <td className="h-[30px] truncate border border-line px-1.5 text-xs">
                      <b>{st.name}</b> <span className="text-muted">{st.regular?.name}</span>
                      {total > 1 ? <span className="text-muted"> {i + 1}회차</span> : null}
                      {applying ? <span className="ml-1 rounded bg-present-soft px-1 font-extrabold text-navy-800" title="신청 숙제반 학생인데 강제도 — 숙제반 시간에 더 집중하도록 독려">🔥신청</span> : null}
                      {iss.length ? (
                        <span className={`ml-1 rounded px-1 font-extrabold ${iss.length >= 2 ? "bg-alert-soft text-alert" : "bg-late-soft text-late"}`} title={iss.map((x) => `${md(x.d)} ${x.why}`).join(", ")}>
                          {iss.length >= 2 ? "⛔인증불가" : "⚠경고"}
                        </span>
                      ) : null}
                    </td>
                    <td className="truncate border border-line px-1.5 text-xs">
                      {h.planLabel(plan)}
                      {edit && !c.gradAt ? (
                        <button type="button" className="btn ml-1 px-1 py-0 text-[11px]" onClick={() => open({ kind: "plan", studentId: st.id })}>
                          ✏️
                        </button>
                      ) : null}
                    </td>
                    <td className="border border-line px-1.5 text-xs">
                      {c.gradAt ? (
                        <b className="text-ok">🎓 {md(c.gradAt)} 졸업</b>
                      ) : (
                        <>
                          <span className="tracking-wide">
                            {"●".repeat(c.streak)}
                            {"○".repeat(4 - c.streak)}
                          </span>{" "}
                          <b>{c.streak}/4</b>
                        </>
                      )}
                    </td>
                    {days.map((d) => {
                      const r = c.results.find((x) => x.d === d);
                      const inCycle = d > c.start && (!c.gradAt || d <= c.gradAt);
                      const p = inCycle ? plan[dowOf(d)] : undefined;
                      let how: "ATTEND" | "CERT" | "ATTEND!" | null = p ? p.how : null;
                      if (how === "CERT" && blockedFrom && d > blockedFrom) how = "ATTEND!";
                      const ct = h.cert.get(st.id)?.get(d);
                      let inner: React.ReactNode = null;
                      if (d === c.start) inner = <span className="rounded bg-alert px-0.5 font-extrabold text-white" title={`${c.startMark ?? ""} → 카운트 ${c.startCount}`}>시작</span>;
                      else if (r?.r === "ok") inner = d === c.gradAt ? "🎓" : <span className="text-sm font-black text-ok">✓</span>;
                      else if (r?.r === "fail") inner = <span title={r.m}>✗</span>;
                      else if (r?.r === "skip") inner = "결";
                      let bg = "";
                      let title = "";
                      if (how === "ATTEND" || how === "ATTEND!") {
                        inner = (
                          <>
                            {inner}
                            {how === "ATTEND!" ? <span title="인증 불가 → 숙제반 참석">🏫!</span> : "🏫"}
                          </>
                        );
                        bg = "bg-present-soft";
                        title = "숙제반 참석 (출결은 데스크)";
                      }
                      const clickable = how === "CERT" && d <= data.today && certEdit(st);
                      if (how === "CERT") {
                        const past = d <= data.today;
                        inner = (
                          <>
                            {inner}
                            {ct === "OK" ? "📷" : ct === "MISS" ? <b className="text-white">📷✗</b> : <span className={past ? "" : "opacity-40"}>📷{past ? "?" : ""}</span>}
                          </>
                        );
                        bg = ct === "MISS" ? MARK_CLS["숙제불량"] : ct === "OK" ? "" : past ? MARK_CLS["숙제미흡"] : "";
                        title = past ? "사진 인증 — 눌러서 인증 확인 / 미인증" : "사진 인증 예정";
                      }
                      const cls = r?.r === "fail" && r.m ? MARK_CLS[r.m] : r?.r === "skip" ? MARK_CLS["결석"] : bg;
                      return (
                        <td
                          key={d}
                          title={title}
                          className={`h-[30px] border border-line text-center ${cls} ${clickable ? "cursor-pointer" : ""}`}
                          onClick={
                            clickable
                              ? () => {
                                  const next = !ct ? "OK" : ct === "OK" ? "MISS" : null;
                                  void act({ action: "CERT", studentId: st.id, date: d, state: next }, next === "MISS" ? `⚠ ${st.name} 미인증 기록` : undefined);
                                }
                              : undefined
                          }
                        >
                          {inner}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-3">
        <div className="card px-4 py-2.5">
          <b className="text-[15px]">🙋 신청 숙제반 — {Number(month.slice(5))}월</b> <span className="text-xs text-muted">출결 = 데스크 · 한 달 단위 신청</span>
          {data.slots.length === 0 ? <p className="text-sm text-muted">반 관리에 숙제반이 없어요.</p> : null}
          <table className="mt-1.5 w-full table-fixed border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="w-12 border border-line bg-navy-50 py-1 text-xs text-muted">요일</th>
                {[...data.slots]
                  .sort((x, y) => x.start - y.start)
                  .map((sl) => (
                    <th key={sl.id} className="border border-line bg-navy-50 py-1 text-xs text-muted">
                      {slotLabel(data.slots, sl)}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {HW_DAYS.map((d) => (
                <tr key={d}>
                  <th className="border border-line bg-navy-50 text-sm">{DAY_LABELS[d]}</th>
                  {[...data.slots]
                    .sort((x, y) => x.start - y.start)
                    .map((sl) => {
                      const list = data.apply.filter((a) => a.slotId === sl.id && a.month === month && a.day === d);
                      return (
                        <td key={sl.id} className="border border-line px-1.5 py-1 align-top">
                          {!sl.days.includes(d) ? <span className="text-xs text-muted">없음</span> : list.length === 0 ? <span className="text-xs text-muted">—</span> : null}
                          {list.map((a) => {
                            const st = h.student(a.studentId);
                            const f = st ? h.tl(st, month).cur : null;
                            return (
                              <span key={a.studentId} className="inline-flex items-center">
                              <button
                                type="button"
                                disabled={!edit}
                                title={edit ? "눌러서 요일 · 시간 고치기" : undefined}
                                onClick={() => open({ kind: "apply", studentId: a.studentId })}
                                className="m-0.5 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[13px] font-bold enabled:hover:bg-navy-50"
                              >
                                {st?.name ?? ""} <span className="font-medium text-muted">{st?.regular?.name ?? ""}</span>
                                {f ? <span className="rounded bg-alert-soft px-1 text-[11px] text-alert">강제도 🔥</span> : null}
                              </button>
                              {purge ? (
                                <TrashButton
                                  title={`${st?.name ?? ""} ${Number(month.slice(5))}월 숙제반 신청 지우기 (관리자)`}
                                  onClick={() => void purge([{ kind: "HW_APPLY", studentId: a.studentId, month }])}
                                />
                              ) : null}
                              </span>
                            );
                          })}
                        </td>
                      );
                    })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted">요일마다 1부 · 2부 중 하나를 골라요. 이름을 누르면 고칠 수 있어요.</p>
        </div>
        <div className="card px-4 py-2.5">
          <b className="text-[15px]">⏰ 지각 3회 → 숙제반 1회</b>
          {data.late.filter((l) => !l.date || l.date.startsWith(month)).length === 0 ? <p className="text-sm text-muted">없어요.</p> : null}
          {data.late
            .filter((l) => !l.date || l.date.startsWith(month))
            .map((l) => {
              const slot = data.slots.find((s) => s.id === l.slotId);
              return (
                <div key={l.id} className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]">
                  <span>
                    <b>{name(l.studentId)}</b> <span className="text-muted">지각 {l.lates.map(md).join(", ")}</span>
                    {carried(l)}
                  </span>
                  <span className="flex items-center gap-1">
                    {l.date ? (
                      <>
                        {mdw(l.date)} {slot ? rangeLabel(slot.start, slot.end) : ""} · {l.done ? "✅ 다녀옴 (지각 0부터)" : "예정 — SR 임시 자리"}
                        {edit ? (
                          <button type="button" className="btn px-1.5 py-0 text-[11px]" onClick={() => void act({ action: "LATE_DONE", id: l.id, done: !l.done })}>
                            {l.done ? "되돌리기" : "다녀옴"}
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <b className="text-alert">날짜 정하기</b>
                    )}
                    {purge ? <TrashButton title="지각 숙제반 지우기 (관리자)" onClick={() => void purge([{ kind: "HW_LATE", id: l.id }])} /> : null}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ 팝업들 */

function PlanModal({ data, h, studentId, act, onClose }: { data: HomeworkData; h: Helpers; studentId: number; act: Act; onClose: () => void }) {
  const st = h.student(studentId)!;
  const [plan, setPlan] = useState<HwPlan>(() => h.planOf(st));
  const save = async () => {
    const ok = await act({ action: "PLAN", studentId, plan }, `${st.name}: ${h.planLabel(plan)} — 참석 요일은 SR 자리도 함께`);
    if (ok) onClose();
  };
  return (
    <Modal
      open
      width={760}
      title={`${st.name} 요일별 방법`}
      subtitle="숙제반에 오는 날 🏫 / 집에서 사진 인증하는 날 📷 (수업 당일 자정까지 오픈채팅방)"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            저장
          </button>
        </>
      }
    >
      {[1, 2, 3, 4, 5].map((d) => {
        const opts = data.slots.filter((s) => s.days.includes(d) && !(st.busy[d] ?? []).some(([a, b]) => a < s.end && s.start < b));
        const cur = plan[d];
        const set = (v: HwPlan[number] | undefined) => setPlan((p) => ({ ...p, [d]: v }));
        return (
          <div key={d} className="mb-1.5 flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
            <b className="w-6">{DAY_LABELS[d]}</b>
            <label className="flex items-center gap-1">
              <input type="radio" checked={!cur} onChange={() => set(undefined)} /> 없음
            </label>
            {opts.map((s) => (
              <label key={s.id} className="flex items-center gap-1">
                <input type="radio" checked={cur?.how === "ATTEND" && cur.slotId === s.id} onChange={() => set({ how: "ATTEND", slotId: s.id })} /> 🏫 {partNo(data.slots, s)}부 {rangeLabel(s.start, s.end)}
              </label>
            ))}
            {opts.length === 0 ? <span className="text-xs text-muted">이 요일 숙제반 없음</span> : null}
            <label className="flex items-center gap-1">
              <input type="radio" checked={cur?.how === "CERT"} onChange={() => set({ how: "CERT" })} /> 📷 사진 인증
            </label>
          </div>
        );
      })}
      <p className="mt-2 text-xs text-muted">
        어느 방법이든 <b>성공 판정은 SR 숙제검사</b>예요. 인증 문제(인증 후 SR 미흡 · 미인증) 1회 = 경고, 2회부터 그 달은 인증 요일도 숙제반 참석.
      </p>
    </Modal>
  );
}

function LateModal({ data, h, lateId, act, onClose }: { data: HomeworkData; h: Helpers; lateId: number; act: Act; onClose: () => void }) {
  const l = data.late.find((x) => x.id === lateId)!;
  const st = h.student(l.studentId);
  const opts = datesBetween(data.today, addDays(data.today, 10)).flatMap((d) =>
    data.slots.filter((s) => s.days.includes(dowOf(d))).map((s) => ({ d, s, clash: st ? (st.busy[dowOf(d)] ?? []).some(([a, b]) => a < s.end && s.start < b) : false })),
  );
  const [pick, setPick] = useState<number | null>(null);
  return (
    <Modal
      open
      width={520}
      title={`${st?.name ?? ""} 지각 숙제반 날짜`}
      subtitle={`지각 ${l.lates.map(md).join(", ")} · 1회만 · 그날 SR 임시 자리가 저절로 잡혀요`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pick === null}
            onClick={() => {
              const o = opts[pick!];
              void act({ action: "LATE_DATE", id: lateId, date: o.d, slotId: o.s.id }, `${st?.name ?? ""} ${mdw(o.d)} 숙제반 1회 — 그날 SR 임시 자리 자동`).then((ok) => ok && onClose());
            }}
          >
            정하기
          </button>
        </>
      }
    >
      <div className="max-h-[340px] overflow-auto">
        {opts.map((o, i) => (
          <label key={`${o.d}-${o.s.id}`} className="mb-1.5 flex cursor-pointer items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
            <span>
              <input type="radio" disabled={o.clash} checked={pick === i} onChange={() => setPick(i)} /> <b>{mdw(o.d)}</b> {partNo(data.slots, o.s)}부 {rangeLabel(o.s.start, o.s.end)}
            </span>
            {o.clash ? <span className="text-xs text-muted">수업과 겹쳐요</span> : null}
          </label>
        ))}
      </div>
    </Modal>
  );
}

/** 🙋 신청 등록 · 고치기 — 월~목 요일마다 없음 / 1부 / 2부 */
function ApplyModal({
  data,
  h,
  months,
  studentId,
  month: initMonth,
  act,
  onClose,
  onMonth,
}: {
  data: HomeworkData;
  h: Helpers;
  months: string[];
  studentId?: number;
  month: string;
  act: Act;
  onClose: () => void;
  onMonth: (m: string) => void;
}) {
  const future = months.filter((m) => m >= data.today.slice(0, 7));
  const [name, setName] = useState(() => (studentId ? h.student(studentId)?.name ?? "" : ""));
  const [month, setMonth] = useState(() => (studentId && initMonth ? initMonth : future[0] ?? data.today.slice(0, 7)));
  const st = data.students.find((s) => s.name === name.trim()) ?? null;
  const [picks, setPicks] = useState<Record<number, number | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  // 학생 · 달이 바뀌면 이미 신청한 요일로 채운다
  useEffect(() => {
    const cur: Record<number, number> = {};
    if (st) for (const a of h.applyOf(st.id, month)) cur[a.day] = a.slotId;
    setPicks(cur);
  }, [st?.id, month, h]);
  const slots = [...data.slots].sort((a, b) => a.start - b.start);
  const list = Object.entries(picks)
    .filter(([, v]) => v)
    .map(([d, v]) => ({ day: Number(d), slotId: v! }));
  const save = async () => {
    if (!st) return setError("학생 이름을 목록에서 골라 주세요.");
    const had = h.applyOf(st.id, month).length > 0;
    if (!list.length && !had) return setError("요일을 하나 이상 골라 주세요.");
    const msg = list.length ? `${st.name} ${Number(month.slice(5))}월 ${applyLabel(data.slots, list)}` : `${st.name} ${Number(month.slice(5))}월 신청 취소`;
    const ok = await act({ action: "APPLY", studentId: st.id, month, picks: list }, msg);
    if (ok) {
      onMonth(month);
      onClose();
    }
  };
  return (
    <Modal
      open
      width={620}
      title={studentId ? "🙋 숙제반 신청 고치기" : "🙋 숙제반 신청 등록"}
      subtitle="월~목 · 요일마다 1부(초등숙제반 시간) 또는 2부(중등숙제반 시간)"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            {list.length || !st || !h.applyOf(st.id, month).length ? "저장" : "신청 취소"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <div>
          <label className="label">학생</label>
          <input className="field" list="hw-names" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} disabled={!!studentId} />
          <datalist id="hw-names">
            {data.students.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label">달</label>
          <select className="field" value={month} onChange={(e) => setMonth(e.target.value)}>
            {(future.includes(month) ? future : [month, ...future]).map((m) => (
              <option key={m} value={m}>
                {Number(m.slice(5))}월
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {HW_DAYS.map((d) => {
          const cur = picks[d];
          const set = (v: number | undefined) => setPicks((p) => ({ ...p, [d]: v }));
          return (
            <div key={d} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <b className="w-6">{DAY_LABELS[d]}</b>
              <button type="button" className={`btn px-2.5 py-1 text-xs ${!cur ? "btn-primary" : ""}`} onClick={() => set(undefined)}>
                없음
              </button>
              {slots
                .filter((s) => s.days.includes(d))
                .map((s) => {
                  const clash = st ? clashOn(s, d, h.busy(st)) : false;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={clash}
                      title={clash ? "수업·SR과 겹쳐요" : undefined}
                      className={`btn px-2.5 py-1 text-xs ${cur === s.id ? "btn-primary" : ""} disabled:opacity-40`}
                      onClick={() => set(s.id)}
                    >
                      {partNo(data.slots, s)}부 {s.name.replace(" 시간", "")} {rangeLabel(s.start, s.end)}
                      {clash ? " · 겹침" : ""}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

type FormRow = { name: string; className: string; dayText: string; studentId: number | null; picks: { day: number; slotId: number }[] | null; already: boolean; note: string };

function FormModal({ data, month, months, act, onClose }: { data: HomeworkData; month: string; months: string[]; act: Act; onClose: () => void }) {
  const [m, setM] = useState(month);
  const [rows, setRows] = useState<FormRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const read = async () => {
    setError(null);
    setLoading(true);
    try {
      setRows((await apiGet<{ rows: FormRow[] }>(`/api/homework?form=${m}`)).rows);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  const ready = (rows ?? []).filter((r) => r.studentId && r.picks && !r.already && !r.note);
  return (
    <Modal
      open
      width={820}
      title="🔄 설문 응답 불러오기"
      subtitle="구글 설문 응답 시트(웹에 게시 → CSV)를 읽어 신청 명단에 넣어요 — 데스크는 확인만"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready.length}
            onClick={() => void act({ action: "FORM_APPLY", month: m, rows: ready.map((r) => ({ studentId: r.studentId, picks: r.picks })) }, `${ready.length}명 신청 명단에 넣었어요`).then((ok) => ok && onClose())}
          >
            {ready.length}명 넣기
          </button>
        </>
      }
    >
      {!data.formUrl ? (
        <p className="text-sm text-alert">
          설정 › <b>숙제반 신청 설문 응답 주소</b>를 먼저 넣어 주세요 (관리자).
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <select className="field w-28" value={m} onChange={(e) => setM(e.target.value)}>
          {months.map((x) => (
            <option key={x} value={x}>
              {Number(x.slice(5))}월 신청
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={!data.formUrl || loading} onClick={() => void read()}>
          {loading ? "읽는 중…" : "응답 읽기"}
        </button>
      </div>
      {rows ? (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="bg-navy-50 text-left text-xs text-muted">
              <th className="px-2 py-1.5">이름</th>
              <th className="px-2 py-1.5">반</th>
              <th className="px-2 py-1.5">요일 (응답)</th>
              <th className="px-2 py-1.5">숙제반</th>
              <th className="px-2 py-1.5">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-2 py-1.5 font-bold">{r.name}</td>
                <td className="px-2 py-1.5">{r.className}</td>
                <td className="px-2 py-1.5">{r.dayText}</td>
                <td className="px-2 py-1.5">{r.picks ? applyLabel(data.slots, r.picks) : "—"}</td>
                <td className="px-2 py-1.5">{r.already ? <span className="text-muted">이미 신청</span> : r.note ? <b className="text-alert">{r.note}</b> : <b className="text-present">넣을 수 있음</b>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}
