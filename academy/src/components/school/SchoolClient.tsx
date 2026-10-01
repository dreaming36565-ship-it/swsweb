"use client";

// 🏫 학교 학사일정 — 📊 학교 × 날짜(한 달 한 장, 학교 = 줄 · 날짜 = 칸 · 시험 = 빨간 막대) · 🏫 학교별 표(칸 눌러 고치기) · 📚 교과서(고등 · 중등).
// 고치기 = 선생님 · 데스크 · 관리자. 시험 D-40 이 되면 관리자 알림함에 「시험대비 일정 세워주세요」(서버 remindSchoolExams).

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { useDataChanged } from "@/lib/dataChanged";
import { can } from "@/lib/perm";
import {
  BOOK_SUBJECTS,
  CAT_LABEL,
  COLS,
  EXAM_ALERT_DAYS,
  GRADE_OPTIONS,
  LEVEL_LABEL,
  LEVELS,
  addDays,
  catOf,
  rangeText,
  shortKind,
  type EventCat,
  type SchoolLevel,
  type SchoolRange,
} from "@/lib/school";
import type { SessionUser } from "@/lib/types";
import type { School, SchoolData, SchoolEvent } from "@/lib/repo/school";

const CAT_CLS: Record<EventCat, string> = {
  ex: "bg-sc-ex-soft text-sc-ex",
  vac: "bg-sc-vac-soft text-sc-vac",
  off: "bg-sc-off-soft text-sc-off",
  ev: "bg-sc-ev-soft text-sc-ev",
  sn: "bg-sc-sn-soft text-sc-sn",
};
const CAT_DOT: Record<EventCat, string> = { ex: "bg-sc-ex", vac: "bg-sc-vac", off: "bg-sc-off", ev: "bg-sc-ev", sn: "bg-sc-sn" };
const CATS = Object.keys(CAT_LABEL) as EventCat[];
const DOW = "일월화수목금토";
const pad = (n: number) => String(n).padStart(2, "0");
const dowOf = (d: string) => new Date(`${d}T00:00:00`).getDay();
const daysOfMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${ym}-${pad(i + 1)}`);
};
const stamp = (e: { updatedBy: string | null; updatedAt: string | null }) => {
  if (!e.updatedBy || !e.updatedAt) return "";
  const d = new Date(e.updatedAt);
  return `${e.updatedBy} · ${d.getMonth() + 1}/${d.getDate()}`;
};

type Dated = SchoolEvent & { from: string; to: string };
type CellTarget = { schoolId: number | null; kind: string | null };

export default function SchoolClient({ user }: { user: SessionUser }) {
  const [data, setData] = useState<SchoolData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"grid" | "sum" | "book">("grid");
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
  const [lvOn, setLvOn] = useState<Record<SchoolLevel, boolean>>({ H: true, M: true, E: true });
  const [catOn, setCatOn] = useState<Record<EventCat, boolean>>({ ex: true, vac: true, off: true, ev: true, sn: true });
  const [cell, setCell] = useState<CellTarget | null>(null);
  const [book, setBook] = useState<{ schoolId: number; subject: string } | null>(null);
  const edit = can(user, "school.write");

  const load = useCallback(async () => {
    try {
      setData(await apiGet<SchoolData>("/api/school"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(load);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const move = (n: number) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };
  const saved = (msg: string) => {
    setCell(null);
    setBook(null);
    setToast(msg);
    void load();
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["grid", "📊 학교 × 날짜"],
              ["sum", "🏫 학교별 표"],
              ["book", "📚 교과서"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={`btn ${tab === k ? "btn-primary" : ""}`} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {tab === "grid" ? (
            <>
              <button type="button" className="btn px-2.5" onClick={() => move(-1)}>
                ◀
              </button>
              <b className="min-w-[110px] text-center text-lg">
                {ym.slice(0, 4)}년 {Number(ym.slice(5))}월
              </b>
              <button type="button" className="btn px-2.5" onClick={() => move(1)}>
                ▶
              </button>
            </>
          ) : null}
          {edit ? (
            <button type="button" className="btn btn-primary ml-2" onClick={() => setCell({ schoolId: null, kind: null })}>
              ＋ 일정 추가
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

      <div className="card flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
        <b className="text-navy-800">학교급</b>
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            className={`rounded-full border border-line px-3 py-1 font-bold ${lvOn[l] ? "bg-white" : "opacity-40"}`}
            onClick={() => setLvOn((v) => ({ ...v, [l]: !v[l] }))}
          >
            {LEVEL_LABEL[l]}
          </button>
        ))}
        {tab !== "book" ? (
          <>
            <span className="w-3" />
            <b className="text-navy-800">종류</b>
            {CATS.map((c) => (
              <button
                key={c}
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-bold ${CAT_CLS[c]} ${catOn[c] ? "" : "opacity-35"}`}
                onClick={() => setCatOn((v) => ({ ...v, [c]: !v[c] }))}
              >
                <span className={`h-2.5 w-2.5 rounded-sm ${CAT_DOT[c]}`} />
                {CAT_LABEL[c]}
              </button>
            ))}
          </>
        ) : null}
        <span className="ml-auto text-xs text-muted">
          시험 D-{EXAM_ALERT_DAYS} = 관리자에게 「시험대비 일정 세워주세요」 알림 {edit ? "· 칸을 누르면 고치기" : ""}
        </span>
      </div>

      {!data ? (
        <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : tab === "grid" ? (
        <GridView data={data} ym={ym} lvOn={lvOn} catOn={catOn} onCell={edit ? (schoolId, kind) => setCell({ schoolId, kind }) : null} />
      ) : tab === "sum" ? (
        <SumView data={data} lvOn={lvOn} catOn={catOn} onCell={edit ? (schoolId, kind) => setCell({ schoolId, kind }) : null} />
      ) : (
        <BookView data={data} lvOn={lvOn} onCell={edit ? (schoolId, subject) => setBook({ schoolId, subject }) : null} />
      )}

      {data && cell ? <CellModal data={data} target={cell} onClose={() => setCell(null)} onSaved={saved} /> : null}
      {data && book ? <BookModal data={data} target={book} onClose={() => setBook(null)} onSaved={saved} /> : null}
      {toast ? <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white">{toast}</div> : null}
    </div>
  );
}

const datedOf = (data: SchoolData) => data.events.filter((e): e is Dated => e.from !== null && e.to !== null);

/* ------------------------------------------------------------ 📊 학교 × 날짜 */

function GridView({
  data,
  ym,
  lvOn,
  catOn,
  onCell,
}: {
  data: SchoolData;
  ym: string;
  lvOn: Record<SchoolLevel, boolean>;
  catOn: Record<EventCat, boolean>;
  onCell: ((schoolId: number, kind: string) => void) | null;
}) {
  const days = daysOfMonth(ym);
  const first = days[0];
  const last = days[days.length - 1];
  const dated = useMemo(() => datedOf(data), [data]);
  return (
    <div className="card overflow-auto">
      <table className="table-fixed border-collapse bg-white text-[11px]" style={{ width: 104 + days.length * 36 }}>
        <colgroup>
          <col style={{ width: 104 }} />
          {days.map((d) => (
            <col key={d} style={{ width: 36 }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 h-[38px] border border-line bg-navy-50 text-xs text-muted">학교</th>
            {days.map((d) => (
              <th
                key={d}
                className={`border border-line leading-tight ${
                  d === data.today ? "bg-now text-white" : dowOf(d) === 0 ? "bg-alert-soft text-alert" : dowOf(d) === 6 ? "bg-navy-50 text-present" : "bg-navy-50 text-muted"
                }`}
              >
                {Number(d.slice(8))}
                <br />
                {DOW[dowOf(d)]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LEVELS.filter((l) => lvOn[l]).map((lv) => (
            <LevelRows key={lv} lv={lv} data={data} dated={dated} days={days} first={first} last={last} catOn={catOn} onCell={onCell} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LevelRows({
  lv,
  data,
  dated,
  days,
  first,
  last,
  catOn,
  onCell,
}: {
  lv: SchoolLevel;
  data: SchoolData;
  dated: Dated[];
  days: string[];
  first: string;
  last: string;
  catOn: Record<EventCat, boolean>;
  onCell: ((schoolId: number, kind: string) => void) | null;
}) {
  const schools = data.schools.filter((s) => s.level === lv);
  return (
    <>
      <tr>
        <td colSpan={days.length + 1} className="border border-line bg-navy-100 px-2 py-1 text-xs font-extrabold text-navy-800">
          {LEVEL_LABEL[lv]}
        </td>
      </tr>
      {schools.map((s) => {
        const mine = dated.filter((e) => e.schoolId === s.id);
        const es = mine.filter((e) => catOn[catOf(e.kind)] && e.to >= first && e.from <= last).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
        // 시험 D-40 표시 (그 달에 D-40 이 오는 시험)
        const d40 = new Map<string, Dated>();
        for (const e of mine) if (catOf(e.kind) === "ex") d40.set(addDays(e.from, -EXAM_ALERT_DAYS), e);
        // 같은 날 두 개면 두 줄
        const lanes: Dated[][] = [];
        for (const e of es) {
          let lane = lanes.find((l) => l.every((x) => x.to < e.from || x.from > e.to));
          if (!lane) lanes.push((lane = []));
          lane.push(e);
        }
        if (!lanes.length) lanes.push([]);
        return lanes.map((lane, li) => (
          <tr key={`${s.id}-${li}`}>
            {li === 0 ? (
              <td rowSpan={lanes.length} className="sticky left-0 z-10 whitespace-nowrap border border-line bg-white px-2 text-[13px] font-bold">
                {s.name}
              </td>
            ) : null}
            {days.map((d) => {
              const e = lane.find((x) => x.from <= d && d <= x.to);
              const bg = d === data.today ? "" : dowOf(d) === 0 ? "bg-alert-soft/40" : "";
              if (!e) {
                const m = li === 0 ? d40.get(d) : undefined;
                return (
                  <td key={d} className={`h-[30px] border border-line p-0 ${bg}`}>
                    {m ? (
                      <span
                        className="mx-0.5 block whitespace-nowrap rounded bg-sc-ex-soft text-center text-[10px] font-extrabold text-sc-ex opacity-80"
                        title={`${s.name} ${m.kind} ${rangeText(m)} — D-${EXAM_ALERT_DAYS}, 관리자에게 시험대비 알림`}
                      >
                        D-{EXAM_ALERT_DAYS}
                      </span>
                    ) : null}
                  </td>
                );
              }
              const start = d === e.from || d === first;
              const end = d === e.to || d === last;
              return (
                <td
                  key={d}
                  className={`h-[30px] border border-line p-0 ${bg} ${onCell ? "cursor-pointer" : ""}`}
                  title={`${s.name} ${e.kind} ${rangeText(e)}${stamp(e) ? ` · ${stamp(e)}` : ""}`}
                  onClick={onCell ? () => onCell(s.id, e.kind) : undefined}
                >
                  <span
                    className={`my-[3px] block h-[22px] overflow-hidden whitespace-nowrap text-[11px] font-extrabold leading-[22px] ${CAT_CLS[catOf(e.kind)]} ${
                      start ? "ml-0.5 rounded-l-md pl-1" : ""
                    } ${end ? "mr-0.5 rounded-r-md" : ""}`}
                  >
                    {start ? `${shortKind(e.kind)}${e.grades ? ` (${e.grades.replace("학년", "")})` : ""}` : " "}
                  </span>
                </td>
              );
            })}
          </tr>
        ));
      })}
    </>
  );
}

/* ------------------------------------------------------------ 🏫 학교별 표 */

function SumView({
  data,
  lvOn,
  catOn,
  onCell,
}: {
  data: SchoolData;
  lvOn: Record<SchoolLevel, boolean>;
  catOn: Record<EventCat, boolean>;
  onCell: ((schoolId: number, kind: string) => void) | null;
}) {
  return (
    <>
      {LEVELS.filter((l) => lvOn[l]).map((lv) => {
        const cols = COLS[lv].filter((k) => catOn[catOf(k)]);
        const schools = data.schools.filter((s) => s.level === lv);
        return (
          <div key={lv} className="card overflow-auto px-3 py-2.5">
            <b className="text-[15px]">{LEVEL_LABEL[lv]}학교</b> <span className="text-xs text-muted">{onCell ? "칸을 누르면 고치기 · " : ""}노란 칸 = 비어 있음 · 「-」 = 없음</span>
            <table className="mt-1.5 w-full border-collapse bg-white text-xs">
              <thead>
                <tr>
                  <th className="border border-line bg-navy-50 px-2 py-1.5 text-muted">학교</th>
                  {cols.map((c) => (
                    <th key={c} className="whitespace-nowrap border border-line bg-navy-50 px-2 py-1.5 text-muted">
                      {c}
                    </th>
                  ))}
                  {catOn.ev ? <th className="whitespace-nowrap border border-line bg-navy-50 px-2 py-1.5 text-muted">그 밖의 일정</th> : null}
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => {
                  const mine = data.events.filter((e) => e.schoolId === s.id);
                  const others = [...new Set(mine.filter((e) => !COLS[lv].includes(e.kind)).map((e) => e.kind))];
                  return (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap border border-line px-2 py-1.5 text-[13px] font-bold">{s.name}</td>
                      {cols.map((k) => (
                        <SumCell key={k} events={mine.filter((e) => e.kind === k)} onClick={onCell ? () => onCell(s.id, k) : undefined} />
                      ))}
                      {catOn.ev ? (
                        <td className="border border-line px-2 py-1.5 align-top">
                          {others.map((k) => (
                            <button
                              key={k}
                              type="button"
                              disabled={!onCell}
                              onClick={() => onCell?.(s.id, k)}
                              className="block text-left enabled:hover:underline"
                            >
                              <b>{k}</b>{" "}
                              {mine
                                .filter((e) => e.kind === k && e.from && e.to)
                                .map((e) => rangeText(e as Dated))
                                .join(", ")}
                            </button>
                          ))}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function SumCell({ events, onClick }: { events: SchoolEvent[]; onClick?: () => void }) {
  const dated = events.filter((e): e is Dated => e.from !== null && e.to !== null);
  const none = events.length > 0 && dated.length === 0;
  return (
    <td
      className={`whitespace-nowrap border border-line px-2 py-1.5 align-top ${events.length === 0 ? "bg-late-soft" : ""} ${onClick ? "cursor-pointer hover:bg-navy-50" : ""}`}
      title={events[0] && stamp(events[0]) ? `마지막 고침: ${stamp(events[0])}` : undefined}
      onClick={onClick}
    >
      {none ? <span className="text-muted">-</span> : dated.map((e) => <div key={e.id}>{rangeText(e)}</div>)}
    </td>
  );
}

/* ------------------------------------------------------------ 📚 교과서 */

function BookView({ data, lvOn, onCell }: { data: SchoolData; lvOn: Record<SchoolLevel, boolean>; onCell: ((schoolId: number, subject: string) => void) | null }) {
  return (
    <>
      {LEVELS.filter((l) => lvOn[l] && BOOK_SUBJECTS[l]).map((lv) => {
        const subjects = BOOK_SUBJECTS[lv]!;
        return (
          <div key={lv} className="card overflow-auto px-3 py-2.5">
            <b className="text-[15px]">📚 {LEVEL_LABEL[lv]} 교과서 (출판사)</b> <span className="text-xs text-muted">{onCell ? "칸을 누르면 고치기 · " : ""}노란 칸 = 비어 있음</span>
            <table className="mt-1.5 w-full border-collapse bg-white text-[13px]">
              <thead>
                <tr>
                  <th className="border border-line bg-navy-50 px-2 py-1.5 text-xs text-muted">학교</th>
                  {subjects.map((b) => (
                    <th key={b} className="whitespace-nowrap border border-line bg-navy-50 px-2 py-1.5 text-xs text-muted">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.schools
                  .filter((s) => s.level === lv)
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap border border-line px-2 py-1.5 font-bold">{s.name}</td>
                      {subjects.map((b) => {
                        const x = data.books.find((k) => k.schoolId === s.id && k.subject === b);
                        return (
                          <td
                            key={b}
                            className={`border border-line px-2 py-1.5 ${x ? "" : "bg-late-soft"} ${onCell ? "cursor-pointer hover:bg-navy-50" : ""}`}
                            title={x && stamp(x) ? `마지막 고침: ${stamp(x)}` : undefined}
                            onClick={onCell ? () => onCell(s.id, b) : undefined}
                          >
                            {x?.publisher ?? ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------ 고치기 창 */

type Row = { grades: string; from: string; to: string };

function CellModal({ data, target, onClose, onSaved }: { data: SchoolData; target: CellTarget; onClose: () => void; onSaved: (msg: string) => void }) {
  const adding = target.schoolId === null || target.kind === null;
  const [schoolId, setSchoolId] = useState<number | null>(target.schoolId);
  const school: School | undefined = data.schools.find((s) => s.id === schoolId);
  const [kindPick, setKindPick] = useState<string>(target.kind ?? "");
  const [custom, setCustom] = useState("");
  const kind = kindPick === "__custom" ? custom.trim() : kindPick;
  const existing = useMemo(() => (school && kind ? data.events.filter((e) => e.schoolId === school.id && e.kind === kind) : []), [data, school, kind]);
  const [rowsState, setRows] = useState<Row[]>(() => {
    const ev = data.events.filter((e) => e.schoolId === target.schoolId && e.kind === target.kind && e.from && e.to);
    return ev.length ? ev.map((e) => ({ grades: e.grades ?? "", from: e.from!, to: e.to! })) : [{ grades: "", from: data.today, to: data.today }];
  });
  const [none, setNone] = useState(() => !adding && existing.length > 0 && existing.every((e) => !e.from));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setRow = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p, ...(p.from && p.from > r.to ? { to: p.from } : {}) } : r)));
  const kinds = school ? COLS[school.level] : [];

  const save = async (clear = false) => {
    setError(null);
    if (!school) return setError("학교를 골라 주세요.");
    if (!kind) return setError("항목을 골라 주세요.");
    const ranges: SchoolRange[] = clear || none ? [] : rowsState.map((r) => ({ grades: r.grades || null, from: r.from, to: r.to }));
    setBusy(true);
    try {
      await apiPost("/api/school", { action: "CELL", schoolId: school.id, kind, ranges, none: !clear && none, append: adding });
      onSaved(clear ? `${school.name} ${kind} 지움` : `${school.name} ${kind} 저장`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const last = existing.find((e) => e.updatedBy);

  return (
    <Modal
      open
      width={640}
      title={adding ? "＋ 일정 추가" : `${school?.name ?? ""} · ${kind}`}
      subtitle={adding ? "학교 · 항목을 고르고 날짜를 넣어요. 목록에 없는 행사(학부모총회 등)는 「직접 입력」." : "날짜는 달력에서 골라요. 학년마다 다르면 줄을 더해요."}
      onClose={onClose}
      footer={
        <>
          {!adding && existing.length ? (
            <button type="button" className="btn btn-danger mr-auto" disabled={busy} onClick={() => void save(true)}>
              칸 비우기
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            저장
          </button>
        </>
      }
    >
      {adding ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <select
            className="field w-40"
            value={schoolId ?? ""}
            onChange={(e) => {
              setSchoolId(e.target.value ? Number(e.target.value) : null);
              setKindPick("");
            }}
          >
            <option value="">학교 고르기</option>
            {LEVELS.map((lv) => (
              <optgroup key={lv} label={LEVEL_LABEL[lv]}>
                {data.schools
                  .filter((s) => s.level === lv)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <select className="field w-44" value={kindPick} onChange={(e) => setKindPick(e.target.value)} disabled={!school}>
            <option value="">항목 고르기</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="__custom">직접 입력 (행사)</option>
          </select>
          {kindPick === "__custom" ? <input className="field flex-1" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="예: 학부모총회" maxLength={30} /> : null}
          {existing.some((e) => e.from) ? (
            <p className="w-full text-xs font-semibold text-late">
              이미 있는 날짜: {existing.filter((e): e is Dated => !!e.from && !!e.to).map((e) => rangeText(e)).join(", ")} — 여기 넣은 날짜는 더해져요.
            </p>
          ) : null}
        </div>
      ) : null}

      {!none ? (
        <>
          <div className="mb-1 grid grid-cols-[130px_150px_20px_150px_40px] gap-1.5 text-xs font-bold text-muted">
            <span>학년 (선택)</span>
            <span>시작</span>
            <span />
            <span>끝</span>
            <span />
          </div>
          {rowsState.map((r, i) => (
            <div key={i} className="mb-1.5 grid grid-cols-[130px_150px_20px_150px_40px] items-center gap-1.5">
              <select className="field" value={r.grades} onChange={(e) => setRow(i, { grades: e.target.value })}>
                <option value="">전학년</option>
                {[...new Set([...GRADE_OPTIONS, ...(r.grades && !GRADE_OPTIONS.includes(r.grades) ? [r.grades] : [])])].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <input className="field" type="date" value={r.from} onChange={(e) => e.target.value && setRow(i, { from: e.target.value })} />
              <span className="text-center">~</span>
              <input className="field" type="date" value={r.to} min={r.from} onChange={(e) => e.target.value && setRow(i, { to: e.target.value })} />
              <button type="button" className="btn px-2 text-alert" disabled={rowsState.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setRows((rs) => [...rs, { ...rs[rs.length - 1] }])}>
            ＋ 학년 줄 더하기
          </button>
        </>
      ) : null}
      {!adding ? (
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} /> 없음 (이 학교는 이 일정이 없어요 — 표에 「-」)
        </label>
      ) : null}
      {catOf(kind) === "ex" && !none ? <p className="mt-2 text-xs text-muted">시험은 D-{EXAM_ALERT_DAYS} 에 관리자에게 「시험대비 일정 세워주세요」 알림이 가요.</p> : null}
      {last ? <p className="mt-2 text-xs text-muted">마지막 고침: {stamp(last)}</p> : null}
      {error ? <p className="mt-2 rounded-lg bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

function BookModal({ data, target, onClose, onSaved }: { data: SchoolData; target: { schoolId: number; subject: string }; onClose: () => void; onSaved: (msg: string) => void }) {
  const school = data.schools.find((s) => s.id === target.schoolId);
  const cur = data.books.find((b) => b.schoolId === target.schoolId && b.subject === target.subject);
  const [pub, setPub] = useState(cur?.publisher ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await apiPost("/api/school", { action: "BOOK", schoolId: target.schoolId, subject: target.subject, publisher: pub });
      onSaved(pub.trim() ? `${school?.name ?? ""} ${target.subject} = ${pub.trim()}` : `${school?.name ?? ""} ${target.subject} 지움`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      width={440}
      title={`${school?.name ?? ""} · ${target.subject}`}
      subtitle="출판사 (예: 천재(전) · 미래엔(황)). 비우고 저장하면 지워져요."
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
      <input
        className="field w-full"
        value={pub}
        autoFocus
        maxLength={30}
        onChange={(e) => setPub(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        placeholder="출판사"
      />
      {cur && stamp(cur) ? <p className="mt-2 text-xs text-muted">마지막 고침: {stamp(cur)}</p> : null}
      {error ? <p className="mt-2 rounded-lg bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}
