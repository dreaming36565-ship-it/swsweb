"use client";

// 보강 관리 — 결석 1건마다 보강이 이루어졌는지 추적한다 (월 12회 / 8회 횟수제 수강료).
// 탭: 처리할 것 / 전체 기록(월·상태별) / 미리 등록된 결석 / 월 정산(관리자).
// 결석은 출결에서 저절로 올라온다. 숨기기 없음 — 보강 완료가 되면 「처리할 것」에서 저절로 빠지고 「전체 기록」에 남는다.

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import TimeSelect from "../TimeSelect";
import ReasonChips from "../attendance/ReasonChips";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { can } from "@/lib/perm";
import { NOTICE_LABEL, STATUS_ORDER, catOfReason, flagsOf, isOpen, statusOf, usesDreamPlus, verdictOf, type MakeupStatus } from "@/lib/makeup";
import { dateKey, fmtTime, monthDay, monthDayWeek, parseDateKey } from "@/lib/time";
import { teacherLabel, type Absence, type AbsenceCat, type AbsenceNotice, type AbsenceRound, type SessionUser } from "@/lib/types";

type Payload = { today: string; absences: Absence[]; students: { id: number; name: string; classNames: string[] }[] };
type Act = (body: Record<string, unknown>, ok?: string) => Promise<boolean>;

const STATUS_CLS: Record<MakeupStatus, string> = {
  조율중: "bg-st-coord text-white",
  "보강 전": "bg-st-before text-st-before-ink",
  "보강 완료": "bg-st-done text-white",
  이월: "bg-st-carry text-white",
  "이월 대기": "border border-late bg-late-soft text-late",
  무단: "border border-alert bg-alert-soft text-alert",
};

const daysSince = (today: string, d: string) => Math.round((parseDateKey(today).getTime() - parseDateKey(d).getTime()) / 86400000);
const ymLabel = (ym: string, today: string) => (ym.slice(0, 4) === today.slice(0, 4) ? `${Number(ym.slice(5))}월` : `${ym.slice(2, 4)}년 ${Number(ym.slice(5))}월`);
const byDate = (a: Absence, b: Absence) => a.date.localeCompare(b.date) || a.studentName.localeCompare(b.studentName, "ko");

export default function MakeupClient({ user }: { user: SessionUser }) {
  const admin = can(user, "absence.judge");
  const fix = can(user, "absence.fix");
  const [data, setData] = useState<Payload | null>(null);
  const [view, setView] = useState<"todo" | "all" | "future" | "settle">("todo");
  const [teacher, setTeacher] = useState<string>(() => (user.roles.includes("TEACHER") && !user.roles.includes("ADMIN") ? String(user.id) : ""));
  const [q, setQ] = useState("");
  const [month, setMonth] = useState(() => dateKey(new Date()).slice(0, 7));
  const [status, setStatus] = useState<MakeupStatus | "">("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [studentName, setStudentName] = useState<string | null>(null);
  const [pre, setPre] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Payload>("/api/absences"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const act: Act = async (body, ok) => {
    setError(null);
    try {
      await apiPost("/api/absences", body);
      await load();
      if (ok) setToast(ok);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  const today = data?.today ?? "";
  const all = data?.absences ?? [];
  const teachers = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of all) if (a.teacherId) m.set(a.teacherId, a.teacherName ?? "");
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "ko"));
  }, [all]);
  const list = all.filter((a) => (!teacher || String(a.teacherId) === teacher) && (!q.trim() || a.studentName.includes(q.trim()) || a.className.includes(q.trim())));
  const todoN = list.filter((a) => a.date <= today && isOpen(a, today)).length;
  const futN = list.filter((a) => a.date > today).length;
  const opened = all.find((a) => a.id === openId) ?? null;

  const table = (rows: Absence[], empty: string, group = false) => <AbsenceTable rows={rows} empty={empty} group={group} today={today} onOpen={setOpenId} onStudent={setStudentName} />;

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["todo", `처리할 것 ${todoN}`],
              ["all", "전체 기록"],
              ["future", `미리 등록된 결석 ${futN}`],
              ...(admin ? [["settle", "월 정산"]] : []),
            ] as [typeof view, string][]
          ).map(([k, n]) => (
            <button key={k} type="button" className={`btn ${view === k ? "btn-primary" : ""}`} onClick={() => setView(k)}>
              {n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select className="field w-32" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">담당 전체</option>
            {teachers.map(([id, name]) => (
              <option key={id} value={id}>
                {teacherLabel(name)}
              </option>
            ))}
          </select>
          <input className="field w-40" placeholder="이름 · 반 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          {fix ? (
            <button type="button" className="btn btn-primary" onClick={() => setPre(true)}>
              📅 결석 미리 등록
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-semibold text-alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setError(null)}>
            닫기
          </button>
        </div>
      ) : null}

      {!data ? (
        <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : view === "todo" ? (
        <>
          <Approvals user={user} list={list} act={act} onOpen={setOpenId} />
          <div className="rounded-xl border border-present-soft bg-present-soft px-4 py-2.5 text-[13px] leading-relaxed text-navy-800">
            끝나지 않은 결석만 보여요. <b>보강 완료가 되면 여기서 저절로 빠지고</b>, 「전체 기록」에는 그대로 남아요. 숨기기 없음. 결석은 <b>출결(출석체크 · 출결전화)에서 저절로</b> 올라와요.
            {list.filter((a) => a.date <= today && isOpen(a, today) && !a.cat).length ? (
              <b className="text-alert"> 인정/개인 판정 필요 {list.filter((a) => a.date <= today && isOpen(a, today) && !a.cat).length}건 (목록에 없는 사유 — 관리자가 정해요)</b>
            ) : null}
          </div>
          {table(list.filter((a) => a.date <= today && isOpen(a, today) && !a.carryReq).sort(byDate), "처리할 결석이 없어요 👍", true)}
        </>
      ) : view === "all" ? (
        <AllRecords list={list} all={all} today={today} month={month} setMonth={setMonth} status={status} setStatus={setStatus} table={table} />
      ) : view === "future" ? (
        <>
          <div className="rounded-xl border border-present-soft bg-present-soft px-4 py-2.5 text-[13px] text-navy-800">
            미리 알려 온 결석이에요. 그날이 되면 <b>출석체크 팝업에 「결석 연락」으로 미리 표시</b>되고, 담당T는 보강을 지금부터 잡을 수 있어요.
          </div>
          {table(list.filter((a) => a.date > today).sort(byDate), "미리 등록된 결석이 없어요", true)}
        </>
      ) : (
        <Settle list={list} all={all} today={today} month={month} setMonth={setMonth} onStudent={setStudentName} />
      )}

      {opened ? <AbsenceModal user={user} a={opened} today={today} act={act} onClose={() => setOpenId(null)} /> : null}
      {studentName ? (
        <Modal open width={1100} title={`${studentName} — 결석 · 보강 이력`} onClose={() => setStudentName(null)}>
          {(() => {
            const mine = all.filter((a) => a.studentName === studentName).sort(byDate);
            const cnt: Record<string, number> = {};
            for (const a of mine) cnt[statusOf(a)] = (cnt[statusOf(a)] ?? 0) + 1;
            return (
              <>
                <p className="mb-2 text-sm text-muted">
                  결석 {mine.length}회 · {Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(" · ")}
                </p>
                <AbsenceTable rows={mine} empty="기록이 없어요" today={today} onOpen={(id) => { setStudentName(null); setOpenId(id); }} onStudent={() => undefined} />
              </>
            );
          })()}
        </Modal>
      ) : null}
      {pre && data ? <PreRegister students={data.students} act={act} onClose={() => setPre(false)} onDone={() => { setPre(false); setView("future"); }} /> : null}
      {toast ? <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white">{toast}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------ 표 */

function RoundChip({ r, today }: { r: AbsenceRound; today: string }) {
  const base = "mr-1 inline-block whitespace-nowrap rounded-md border px-1.5 py-px text-xs";
  if (r.type === "TASK") return <span className={`${base} ${r.state === "DONE" ? "border-present-soft bg-present-soft text-present" : "border-line bg-white"}`}>📄 과제로 대체{r.state === "DONE" ? " ✓" : ""}</span>;
  const late = r.state === "PLANNED" && !!r.date && r.date < today;
  const cls =
    r.state === "DONE"
      ? "border-present-soft bg-present-soft text-present"
      : r.state === "MISSED"
        ? "border-alert-soft bg-alert-soft text-alert line-through"
        : late
          ? "border-late bg-late-soft font-bold text-late"
          : "border-line bg-white";
  const icon = r.state === "DONE" ? "✅" : r.state === "MISSED" ? "❌" : "🗓";
  return (
    <span className={`${base} ${cls}`}>
      {icon} {r.date ? monthDayWeek(r.date) : ""} {r.startMin !== null ? fmtTime(r.startMin) : ""}
    </span>
  );
}

function CatTag({ a }: { a: Absence }) {
  const v = verdictOf(a);
  const base = "ml-1 inline-block whitespace-nowrap rounded px-1.5 text-[11px] font-extrabold";
  return (
    <>
      {v === "판정 필요" ? (
        <span className={`${base} bg-navy-50 text-muted`}>판정 필요</span>
      ) : v === "인정" ? (
        <span className={`${base} bg-ok-soft text-ok`}>인정</span>
      ) : (
        <span className={`${base} bg-alert-soft text-alert`}>무단{a.cat === "PERSONAL" ? " · 개인사유" : a.notice === "SAME_DAY" ? " · 당일 알림" : " · 무연락"}</span>
      )}
      {a.paid ? <span className={`${base} bg-late-soft text-late`}>💰 유료</span> : null}
    </>
  );
}

const StatusChip = ({ s }: { s: MakeupStatus }) => <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-extrabold ${STATUS_CLS[s]}`}>{s}</span>;
const Flag = ({ f }: { f: string }) => <span className="ml-1 inline-block whitespace-nowrap rounded bg-alert-soft px-1 text-[11px] font-extrabold text-alert">{f}</span>;

function AbsenceTable({
  rows,
  empty,
  group = false,
  today,
  onOpen,
  onStudent,
}: {
  rows: Absence[];
  empty: string;
  group?: boolean;
  today: string;
  onOpen: (id: number) => void;
  onStudent: (name: string) => void;
}) {
  if (!rows.length) return <div className="card p-8 text-center text-sm text-muted">{empty}</div>;
  let cur = "";
  const body: React.ReactNode[] = [];
  for (const a of rows) {
    const ym = a.date.slice(0, 7);
    if (group && ym !== cur) {
      cur = ym;
      body.push(
        <tr key={`g${ym}`}>
          <td colSpan={9} className="bg-navy-100 px-3 py-1.5 font-extrabold text-navy-900">
            {ym.slice(0, 4)}년 {Number(ym.slice(5))}월 결석 · {rows.filter((x) => x.date.startsWith(ym)).length}건
          </td>
        </tr>,
      );
    }
    const st = statusOf(a);
    const n = daysSince(today, a.date);
    body.push(
      <tr key={a.id} className="cursor-pointer border-t border-line hover:bg-navy-50" onClick={() => onOpen(a.id)}>
        <td className="px-3 py-2">
          <button
            type="button"
            className="font-extrabold text-navy-900 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onStudent(a.studentName);
            }}
          >
            {a.studentName}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-2">{a.className}</td>
        <td className="whitespace-nowrap px-3 py-2">{teacherLabel(a.teacherName)}</td>
        <td className="whitespace-nowrap px-3 py-2">
          {monthDayWeek(a.date)}
          <span className={`ml-1 text-[11px] ${n >= 14 && isOpen(a, today) ? "font-extrabold text-alert" : "text-muted"}`}>{a.date > today ? "예정" : n === 0 ? "오늘" : `${n}일 전`}</span>
        </td>
        <td className="px-3 py-2">
          {a.reason}
          <CatTag a={a} />
        </td>
        <td className="px-3 py-2">
          {a.carried ? <span className="text-muted">이월 — {a.carried.reason}</span> : a.rounds.length ? a.rounds.map((r) => <RoundChip key={r.id} r={r} today={today} />) : <span className="text-muted">—</span>}
          {a.more ? <span className="rounded-md border border-line px-1.5 text-xs">+ 남은 보강 있음</span> : null}
        </td>
        <td className="px-3 py-2">
          <StatusChip s={st} />
          {flagsOf(a, today).map((f) => (
            <Flag key={f} f={f} />
          ))}
        </td>
        <td className="px-3 py-2 text-center">{usesDreamPlus(a) ? (a.dream ? "✓" : <span className="text-navy-200">·</span>) : <span className="text-muted" title="고등부 — 이 앱에만 기록">—</span>}</td>
        <td className="max-w-[170px] truncate px-3 py-2 text-xs text-muted">{a.memo.split("\n")[0]}</td>
      </tr>,
    );
  }
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-navy-50 text-left text-xs text-muted">
            {["이름", "반", "담당", "결석일", "사유 · 구분", "보강", "상태", "드림+", "메모"].map((h) => (
              <th key={h} className="px-3 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ 이월 결재 대기 */

function Approvals({ user, list, act, onOpen }: { user: SessionUser; list: Absence[]; act: Act; onOpen: (id: number) => void }) {
  const [reject, setReject] = useState<Absence | null>(null);
  const wait = list.filter((a) => a.carryReq);
  if (!wait.length) return null;
  const admin = can(user, "absence.judge");
  return (
    <div className="rounded-xl border border-late bg-late-soft px-4 py-2.5">
      <h4 className="text-sm font-bold text-late">
        🖊 이월 결재 대기 {wait.length}건 {admin ? null : <span className="font-semibold">— 관리자가 승인하면 확정돼요</span>}
      </h4>
      {wait.map((a) => (
        <div key={a.id} className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px]">
          <span className="flex-1">
            <b>{a.studentName}</b> · {a.className} · {monthDayWeek(a.date)} 결석 — {a.carryReq!.reason}{" "}
            <span className="text-muted">
              ({a.carryReq!.by} 요청, {monthDay(a.carryReq!.at)})
            </span>
          </span>
          <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => onOpen(a.id)}>
            보기
          </button>
          {admin ? (
            <>
              <button type="button" className="btn btn-primary px-2 py-0.5 text-xs" onClick={() => void act({ action: "CARRY_DECIDE", id: a.id, ok: true }, `${a.studentName} 이월 승인 → 담당T 알림`)}>
                승인
              </button>
              <button type="button" className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => setReject(a)}>
                반려
              </button>
            </>
          ) : null}
        </div>
      ))}
      {reject ? <RejectModal a={reject} act={act} onClose={() => setReject(null)} /> : null}
    </div>
  );
}

function RejectModal({ a, act, onClose }: { a: Absence; act: Act; onClose: () => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      width={460}
      title="이월 반려"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void act({ action: "CARRY_DECIDE", id: a.id, ok: false, note }, "반려 → 담당T 알림").then((ok) => ok && onClose())}>
            반려
          </button>
        </>
      }
    >
      <p className="text-sm">
        {a.studentName} · {monthDayWeek(a.date)} — {a.carryReq?.reason} ({a.carryReq?.by})
      </p>
      <label className="label mt-3">반려 사유</label>
      <input className="field" placeholder="예) 토요일 보강 가능한지 한 번 더 확인" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
    </Modal>
  );
}

/* ------------------------------------------------------------ 전체 기록 · 월 정산 */

function MonthTabs({ months, month, setMonth, today }: { months: string[]; month: string; setMonth: (m: string) => void; today: string }) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line">
      {months.map((m) => (
        <button key={m} type="button" className={`border-r border-line px-3 py-1.5 text-sm font-bold last:border-r-0 ${month === m ? "bg-navy-800 text-white" : "bg-white text-muted"}`} onClick={() => setMonth(m)}>
          {ymLabel(m, today)}
        </button>
      ))}
    </div>
  );
}

function AllRecords({
  list,
  all,
  today,
  month,
  setMonth,
  status,
  setStatus,
  table,
}: {
  list: Absence[];
  all: Absence[];
  today: string;
  month: string;
  setMonth: (m: string) => void;
  status: MakeupStatus | "";
  setStatus: (s: MakeupStatus | "") => void;
  table: (rows: Absence[], empty: string, group?: boolean) => React.ReactNode;
}) {
  const months = [...new Set(all.map((a) => a.date.slice(0, 7)))].sort();
  const inMonth = list.filter((a) => a.date.startsWith(month));
  const counts: Record<string, number> = {};
  for (const a of inMonth) counts[statusOf(a)] = (counts[statusOf(a)] ?? 0) + 1;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <MonthTabs months={months} month={month} setMonth={setMonth} today={today} />
        <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line">
          {(["", ...STATUS_ORDER] as (MakeupStatus | "")[]).map((s) => (
            <button key={s || "all"} type="button" className={`border-r border-line px-3 py-1.5 text-sm font-bold last:border-r-0 ${status === s ? "bg-navy-800 text-white" : "bg-white text-muted"}`} onClick={() => setStatus(s)}>
              {s || "전체"} {s ? counts[s] ?? 0 : inMonth.length}
            </button>
          ))}
        </div>
      </div>
      {table(inMonth.filter((a) => !status || statusOf(a) === status).sort(byDate), "기록이 없어요")}
    </>
  );
}

function Settle({ list, all, today, month, setMonth, onStudent }: { list: Absence[]; all: Absence[]; today: string; month: string; setMonth: (m: string) => void; onStudent: (n: string) => void }) {
  const months = [...new Set(all.map((a) => a.date.slice(0, 7)))].filter((m) => m <= today.slice(0, 7)).sort();
  const by = new Map<string, { name: string; cls: Set<string>; n: number; done: number; ing: number; wait: number; carried: number; nodeal: number; paid: number }>();
  for (const a of list.filter((x) => x.date.startsWith(month) && x.date <= today)) {
    const r = by.get(a.studentName) ?? { name: a.studentName, cls: new Set<string>(), n: 0, done: 0, ing: 0, wait: 0, carried: 0, nodeal: 0, paid: 0 };
    r.cls.add(a.className);
    r.n++;
    const st = statusOf(a);
    if (st === "보강 완료") r.done++;
    else if (st === "이월") r.carried++;
    else if (st === "이월 대기") r.wait++;
    else if (st === "무단") r.nodeal++;
    else r.ing++;
    if (a.paid) r.paid++;
    by.set(a.studentName, r);
  }
  const rows = [...by.values()].sort((a, b) => b.carried - a.carried || b.wait - a.wait || b.ing - a.ing || a.name.localeCompare(b.name, "ko"));
  const sum = (k: "n" | "done" | "ing" | "wait" | "carried" | "nodeal" | "paid") => rows.reduce((s, r) => s + r[k], 0);
  const cell = (x: number, hot = false) => (x ? <b className={hot ? "text-alert" : ""}>{x}</b> : <span className="text-navy-200">0</span>);
  const kpi = (label: string, v: number, sub?: string, hot = false) => (
    <div className="card px-3.5 py-3">
      <span className="text-xs font-bold text-muted">{label}</span>
      <b className={`block text-[26px] ${hot && v ? "text-alert" : "text-navy-900"}`}>{v}</b>
      {sub ? <span className="text-xs font-bold text-muted">{sub}</span> : null}
    </div>
  );
  return (
    <>
      <MonthTabs months={months} month={month} setMonth={setMonth} today={today} />
      <div className="rounded-xl border border-late bg-late-soft px-4 py-2.5 text-[13px] text-late">
        시트에서는 <b>2026년 9월 이후 · 보강 완료가 아닌 기록만</b> 옮겨 와서, 9월의 「결석 · 보강 완료」 숫자는 실제보다 적어요. 앱을 쓰기 시작한 달부터 정확해져요. 이월 = 담당T 요청 → <b>관리자 승인</b>된 회차 → 다음 달 수강료에서 빠짐.
      </div>
      <div className="grid grid-cols-5 gap-2.5">
        {kpi("결석", sum("n"))}
        {kpi("보강 완료", sum("done"), `${sum("n") ? Math.round((sum("done") / sum("n")) * 100) : 0}%`)}
        {kpi("아직 진행 중", sum("ing"), "조율중 · 보강 전", true)}
        {kpi("다음 달 이월 (승인)", sum("carried"), `결재 대기 ${sum("wait")}건`)}
        {kpi("무단 (무료 보강 없음)", sum("nodeal"), `유료 보강 ${sum("paid")}건`)}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-navy-50 text-left text-xs text-muted">
              {["이름", "반", "결석", "보강 완료", "진행 중", "이월 결재 대기", "이월 → 다음 달", "무단", "유료 보강"].map((h, i) => (
                <th key={h} className={`px-3 py-2.5 font-semibold ${i > 1 ? "text-center" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">
                  이 달 결석이 없어요
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.name} className="cursor-pointer border-t border-line hover:bg-navy-50" onClick={() => onStudent(r.name)}>
                <td className="px-3 py-2 font-bold">{r.name}</td>
                <td className="px-3 py-2">{[...r.cls].join(", ")}</td>
                <td className="px-3 py-2 text-center">{r.n}</td>
                <td className="px-3 py-2 text-center">{cell(r.done)}</td>
                <td className="px-3 py-2 text-center">{cell(r.ing, true)}</td>
                <td className="px-3 py-2 text-center">{cell(r.wait)}</td>
                <td className="px-3 py-2 text-center">{cell(r.carried, true)}</td>
                <td className="px-3 py-2 text-center">{cell(r.nodeal)}</td>
                <td className="px-3 py-2 text-center">{cell(r.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ 결석 1건 */

function Seg<T extends string>({ items, value, onPick, disabled }: { items: [T, string][]; value: T | null; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line">
      {items.map(([k, label]) => (
        <button key={k} type="button" disabled={disabled} className={`border-r border-line px-3 py-1.5 text-sm font-bold last:border-r-0 ${value === k ? "bg-navy-800 text-white" : "bg-white text-muted"}`} onClick={() => onPick(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function AbsenceModal({ user, a, today, act, onClose }: { user: SessionUser; a: Absence; today: string; act: Act; onClose: () => void }) {
  const fix = can(user, "absence.fix");
  const judge = can(user, "absence.judge");
  const owner = user.roles.includes("TEACHER") && a.teacherId === user.id;
  const st = statusOf(a);
  const v = verdictOf(a);
  const blocked = v === "무단" && !a.paid;
  const tOk = owner && !a.carried && !a.carryReq && !blocked;
  const [reason, setReason] = useState(a.reason);
  const [memo, setMemo] = useState(a.memo);
  const [date, setDate] = useState(today);
  const [min, setMin] = useState<number | null>(16 * 60);
  const [carry, setCarry] = useState(false);
  const [reject, setReject] = useState(false);
  const up = (patch: Record<string, unknown>, ok?: string) => act({ action: "UPDATE", id: a.id, ...patch }, ok);

  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (reason.trim() !== a.reason) patch.reason = reason;
    if (memo !== a.memo) patch.memo = memo;
    if (Object.keys(patch).length && !(await up(patch, "저장했어요"))) return;
    onClose();
  };

  return (
    <Modal
      open
      width={980}
      title={
        <>
          {a.studentName}{" "}
          <span className="text-[15px] font-semibold text-muted">
            {a.className} · {teacherLabel(a.teacherName)}
          </span>
        </>
      }
      subtitle={
        <>
          결석 <b className="text-ink">{monthDayWeek(a.date)}</b> <StatusChip s={st} />
          {flagsOf(a, today).map((f) => (
            <Flag key={f} f={f} />
          ))}
        </>
      }
      onClose={onClose}
      footer={
        <>
          {fix && a.notice === "PRE" && a.date > today && a.rounds.length === 0 ? (
            <button type="button" className="btn btn-danger mr-auto" onClick={() => void act({ action: "DELETE", id: a.id }, "미리 등록한 결석을 지웠어요").then((ok) => ok && onClose())}>
              등록 취소
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            저장
          </button>
        </>
      }
    >
      <section className="mb-2.5 rounded-xl border border-line px-3.5 py-3">
        <h3 className="mb-2 flex items-center justify-between text-sm font-bold text-navy-900">
          결석 <small className="text-xs font-semibold text-muted">출결에서 자동 기록 · 사유 = 데스크 · 관리자 / 구분 = 관리자</small>
        </h3>
        <div className="mb-2 text-xs text-muted">📥 {a.source || "—"}</div>
        <div className="flex flex-wrap items-end gap-2.5">
          <div>
            <span className="label">사유</span>
            <input className="field w-56" value={reason} disabled={!fix} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <span className="label">구분</span>
            <Seg<AbsenceCat>
              items={[
                ["OK", "인정 사유"],
                ["PERSONAL", "개인사유"],
              ]}
              value={a.cat}
              disabled={!judge}
              onPick={(c) => void up({ cat: c })}
            />
          </div>
          <div>
            <span className="label">알린 때</span>
            <Seg<AbsenceNotice>
              items={(Object.keys(NOTICE_LABEL) as AbsenceNotice[]).map((k) => [k, NOTICE_LABEL[k]])}
              value={a.notice}
              disabled={!fix}
              onPick={(n) => void up({ notice: n })}
            />
          </div>
        </div>
        {fix ? (
          <>
            <ReasonChips
              value={a.reason}
              onPick={(r) => {
                setReason(r);
                void up({ reason: r });
              }}
            />
            <p className="mt-1 text-[11px] text-muted">그 밖: 사유 칸에 직접 쓰고 저장 → 판정 필요 (관리자)</p>
          </>
        ) : null}
        <div
          className={`mt-2 rounded-lg border px-3 py-2 text-[13px] font-bold ${
            v === "인정" ? "border-ok-soft bg-ok-soft text-ok" : v === "무단" ? "border-late bg-late-soft text-late" : "border-line bg-navy-50 text-muted"
          }`}
        >
          {v === "인정" ? "✔ 인정 결석 — 무료 보강" : v === "무단" ? "✖ 무단 결석 — 무료 보강 없음 (원하면 유료 보강 5,000콩알)" : judge ? "? 판정 필요 — 「구분」에서 인정 사유 / 개인사유를 골라 주세요" : "? 판정 필요 — 관리자가 정해요"}
          <div className="mt-1 font-semibold opacity-80">
            규칙: 학생에게 선택권이 없으면 인정(아픔 · 가족여행 · 가족행사 · 경조사 · 학교 일정) / 고를 수 있었으면 개인사유 → 무단(친구 생일 · 다른 학원 · 개인 약속) / 병결 외 당일 알림 · 무연락 → 무단
          </div>
          {fix && v === "무단" ? (
            <button type="button" className={`btn mt-1.5 px-2.5 py-1 text-xs ${a.paid ? "btn-primary" : ""}`} onClick={() => void up({ paid: !a.paid })}>
              💰 유료 보강 진행 (콩알 차감)
            </button>
          ) : null}
        </div>
      </section>

      <section className="mb-2.5 rounded-xl border border-line px-3.5 py-3">
        <h3 className="mb-2 flex items-center justify-between text-sm font-bold text-navy-900">
          보강 <small className="text-xs font-semibold text-muted">{owner ? "담당T (나)" : `${teacherLabel(a.teacherName)}만 입력 — 보기만`}</small>
        </h3>
        {a.carryReq ? (
          <div className="mb-2 rounded-lg border border-line bg-navy-50 px-3 py-2 text-[13px] font-bold text-muted">
            🖊 이월 결재 대기 — {a.carryReq.reason} ({a.carryReq.by} 요청, {monthDay(a.carryReq.at)})
            <div className="mt-1.5 flex gap-1.5">
              {judge ? (
                <>
                  <button type="button" className="btn btn-primary px-2.5 py-1 text-xs" onClick={() => void act({ action: "CARRY_DECIDE", id: a.id, ok: true }, "이월 승인 → 담당T 알림")}>
                    승인
                  </button>
                  <button type="button" className="btn btn-danger px-2.5 py-1 text-xs" onClick={() => setReject(true)}>
                    반려
                  </button>
                </>
              ) : null}
              {owner ? (
                <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => void act({ action: "CARRY_CANCEL", id: a.id })}>
                  요청 취소
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {a.carried ? (
          <div className="mb-2 rounded-lg border border-late bg-late-soft px-3 py-2 text-[13px] font-bold text-late">
            이월 확정 — {a.carried.reason} ({a.carried.by} 요청 · {a.carried.approvedBy} 승인 {monthDay(a.carried.at)})
          </div>
        ) : null}
        {a.rejected && !a.carryReq && !a.carried ? (
          <div className="mb-2 rounded-lg border border-late bg-late-soft px-3 py-2 text-[13px] font-bold text-late">
            이월 반려 — {a.rejected.note || "사유 없음"} ({a.rejected.by}) → 보강을 진행해 주세요
          </div>
        ) : null}
        {a.rounds.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-dashed border-line py-1.5 text-[13px] last:border-b-0">
            <b className="w-8">{i + 1}차</b>
            <span className="flex-1">
              <RoundChip r={r} today={today} />
            </span>
            {tOk && r.state === "PLANNED" ? (
              <>
                <button type="button" className="btn btn-primary px-2 py-0.5 text-xs" onClick={() => void act({ action: "ROUND_STATE", roundId: r.id, state: "DONE" })}>
                  완료
                </button>
                {r.type === "MAKEUP" ? (
                  <button type="button" className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => void act({ action: "ROUND_STATE", roundId: r.id, state: "MISSED" }, "보강 결석 — 다음 보강은 유료예요 (5,000콩알)")}>
                    보강 결석
                  </button>
                ) : null}
              </>
            ) : null}
            {tOk && r.state !== "PLANNED" ? (
              <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => void act({ action: "ROUND_STATE", roundId: r.id, state: "PLANNED" })}>
                되돌리기
              </button>
            ) : null}
            {tOk ? (
              <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => void act({ action: "ROUND_DELETE", roundId: r.id })}>
                삭제
              </button>
            ) : null}
          </div>
        ))}
        {a.rounds.length === 0 && !a.carried && !a.carryReq ? (
          <div className="text-[13px] text-muted">{blocked ? "무단 결석 — 무료 보강 없음. 데스크가 「💰 유료 보강 진행」을 누르면 일정을 넣을 수 있어요." : "아직 보강 일정이 없어요 → 「조율중」"}</div>
        ) : null}
        {tOk ? (
          <>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-navy-50 p-2">
              <input type="date" className="field w-40" value={date} onChange={(e) => setDate(e.target.value)} />
              <TimeSelect className="w-44" value={min} onChange={setMin} />
              <button type="button" className="btn btn-primary px-2.5 py-1 text-xs" onClick={() => void act({ action: "ADD_ROUND", id: a.id, type: "MAKEUP", date, startMin: min })}>
                + 보강 추가
              </button>
              <span className="text-xs text-muted">또는</span>
              <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => void act({ action: "ADD_ROUND", id: a.id, type: "TASK" })}>
                📄 과제로 대체
              </button>
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={a.more} onChange={() => void up({ more: !a.more })} /> 나눠서 진행 — 남은 보강 있음 <span className="text-muted">(체크하면 다 끝나도 「보강 전」)</span>
            </label>
          </>
        ) : null}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {usesDreamPlus(a) ? (
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={a.dream} disabled={!owner} onChange={() => void up({ dream: !a.dream })} /> 드림플러스에 보강 기록함
            </label>
          ) : (
            <span className="text-xs text-muted">고등부 — 에듀OK 대신 이 앱에만 기록</span>
          )}
          {tOk && st !== "보강 완료" && v !== "무단" ? (
            <button type="button" className="btn btn-danger px-2.5 py-1 text-xs" onClick={() => setCarry(true)}>
              보강 진행 어려움 → 이월 요청
            </button>
          ) : null}
        </div>
      </section>

      <section className="mb-2.5 rounded-xl border border-line px-3.5 py-3">
        <h3 className="mb-2 text-sm font-bold text-navy-900">메모</h3>
        <textarea className="field h-16" placeholder="특이사항" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </section>
      <div className="text-xs leading-relaxed text-muted">
        {a.log.map((l, i) => (
          <div key={i}>{l.text}</div>
        ))}
      </div>
      {carry ? <CarryModal a={a} act={act} onClose={() => setCarry(false)} /> : null}
      {reject ? <RejectModal a={a} act={act} onClose={() => setReject(false)} /> : null}
    </Modal>
  );
}

function CarryModal({ a, act, onClose }: { a: Absence; act: Act; onClose: () => void }) {
  const [pick, setPick] = useState("학부모 홀딩 요청");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (pick === "기타" && !note.trim()) return setError("기타는 내용을 적어 주세요.");
    const ok = await act({ action: "CARRY_REQUEST", id: a.id, reason: note.trim() ? `${pick} — ${note.trim()}` : pick }, "관리자에게 결재 요청 → 🔔 알림");
    if (ok) onClose();
  };
  return (
    <Modal
      open
      width={520}
      title="이월 요청"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void send()}>
            결재 요청
          </button>
        </>
      }
    >
      <p className="text-sm">
        {a.studentName} · {monthDayWeek(a.date)} 결석을 <b>보강 없이 마무리</b>하고, 이 회차 금액을 <b>다음 달로 이월</b>해요.
        <br />
        <b>관리자가 승인해야 확정</b>돼요.
      </p>
      <span className="label mt-3">사유 (꼭)</span>
      <Seg<string> items={["학부모 홀딩 요청", "보강 시간 조정 어려움", "퇴원", "기타"].map((r) => [r, r])} value={pick} onPick={setPick} />
      <input className="field mt-2" placeholder="자세한 내용 (선택)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------ 결석 미리 등록 */

function PreRegister({ students, act, onClose, onDone }: { students: Payload["students"]; act: Act; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState(() => dateKey(new Date()));
  const [to, setTo] = useState(() => dateKey(new Date()));
  const [reason, setReason] = useState("");
  const [dates, setDates] = useState<{ date: string; className: string; teacherName: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const st = students.find((s) => s.name === name.trim());

  useEffect(() => {
    setDates(null);
    if (!st || !from || !to || from > to) return;
    apiGet<{ dates: { date: string; className: string; teacherName: string | null }[] }>(`/api/absences?preview=${st.id}&from=${from}&to=${to}`)
      .then((d) => setDates(d.dates))
      .catch((e) => setError(errorMessage(e)));
  }, [st, from, to]);

  const save = async () => {
    setError(null);
    if (!st) return setError("학생 이름을 목록에서 골라 주세요.");
    if (!reason) return setError("사유를 골라 주세요.");
    const ok = await act({ action: "PRE_REGISTER", studentId: st.id, from, to, reason }, `${st.name} 결석 등록 → 담당T 알림`);
    if (ok) onDone();
  };

  return (
    <Modal
      open
      width={760}
      title="📅 결석 미리 등록"
      subtitle="기간을 고르면 그 사이 수업 날짜가 저절로 나와요."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            등록
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-2.5">
        <div>
          <span className="label">학생</span>
          <input className="field w-44" list="pre-names" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="pre-names">
            {students.map((s) => (
              <option key={s.id} value={s.name}>
                {s.classNames.join(", ")}
              </option>
            ))}
          </datalist>
        </div>
        <div>
          <span className="label">기간</span>
          <div className="flex items-center gap-1">
            <input type="date" className="field w-40" value={from} onChange={(e) => setFrom(e.target.value)} /> ~
            <input type="date" className="field w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <span className="label">사유</span>
        <ReasonChips value={reason} onPick={(r) => setReason(r)} />
        {reason ? (
          <p className="mt-1 text-xs text-muted">
            → {reason} ({catOfReason(reason) === "OK" ? "인정" : "개인사유 · 무단"})
          </p>
        ) : null}
      </div>
      <div className="mt-3">
        {!name ? null : !st ? (
          <div className="text-sm text-muted">학생 이름을 목록에서 골라 주세요.</div>
        ) : dates === null ? (
          <div className="text-sm text-muted">불러오는 중…</div>
        ) : dates.length === 0 ? (
          <div className="text-sm text-muted">그 기간에 수업이 없어요.</div>
        ) : (
          <>
            <div className="label">결석 {dates.length}회</div>
            {dates.map((d) => (
              <span key={`${d.date}-${d.className}`} className="mb-1 mr-1 inline-block rounded-md border border-line px-1.5 py-px text-xs">
                {monthDayWeek(d.date)} · {d.className} · {teacherLabel(d.teacherName)}
              </span>
            ))}
          </>
        )}
      </div>
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}
