"use client";

// 📅 월간 스케줄 — 시간표 「📅 월간 스케줄」 탭 (관리자 · 데스크).
// 1 휴강일 · 행사  2 반별 횟수 맞추기  3 안내문(카톡용 그림). 시안 public/mockups/schedule.html (4차).
// 휴강은 유투엠 · 스킬 같음 — 학원 버튼은 행사 · 횟수 표 · 안내문만 바뀐다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { useDataChanged } from "@/lib/dataChanged";
import { useConfirm } from "../ConfirmDialog";
import { SCHED_EVENT_COLORS } from "@/lib/colors";
import {
  BRAND_LABEL,
  countOf,
  dayOf,
  dowOf,
  examLines,
  feeLabel,
  holidayOf,
  isAllOff,
  mdw,
  mdwLong,
  monNo,
  monthOf,
  monthWeeks,
  shiftMonth,
  weekBars,
  daysLabel,
  type Brand,
  type SchedEvent,
} from "@/lib/schedule";
import type { ScheduleData } from "@/lib/repo/schedule";
import PosterStep from "./PosterStep";

const DOW = "일월화수목금토";
export type Act = (body: Record<string, unknown>, ok?: string) => Promise<unknown>;

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const EMOJIS = ["", "🚩", "🏆", "📝", "⏰", "💬", "👑", "📖", "✏️", "🐰", "🎉", "📢", "⭐", "🎯", "📚"];

export default function ScheduleClient({ initialMonth }: { initialMonth?: string }) {
  const [month, setMonth] = useState(() => (initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : thisMonth()));
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [brand, setBrand] = useState<Brand>("U");
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<ScheduleData>(`/api/schedule?month=${month}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(load);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const act: Act = useCallback(
    async (body, ok) => {
      try {
        const r = await apiPost("/api/schedule", body);
        if (ok) setToast(ok);
        await load();
        return r;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      }
    },
    [load],
  );

  const sel2 = sel && monthOf(sel) === month ? sel : `${month}-01`;
  const months = [-1, 0, 1, 2, 3].map((n) => shiftMonth(thisMonth(), n));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn px-2.5" onClick={() => setMonth(shiftMonth(month, -1))}>
            ◀
          </button>
          {[...new Set([...months, month])].sort().map((m) => (
            <button key={m} type="button" className={`btn px-3 ${m === month ? "btn-primary" : ""}`} onClick={() => setMonth(m)}>
              {monNo(m)}월
            </button>
          ))}
          <button type="button" className="btn px-2.5" onClick={() => setMonth(shiftMonth(month, 1))}>
            ▶
          </button>
        </div>
        <span className="w-3" />
        {(
          [
            [1, "휴강일 · 행사"],
            [2, "반별 횟수 맞추기"],
            [3, "안내문 (카톡용)"],
          ] as const
        ).map(([n, t]) => (
          <button
            key={n}
            type="button"
            className={`rounded-full border px-4 py-1.5 text-sm font-bold ${step === n ? "border-navy-800 bg-navy-800 text-white" : "border-line bg-white text-muted"}`}
            onClick={() => setStep(n)}
          >
            <span className={`mr-1 inline-block h-5 w-5 rounded-full text-center text-xs leading-5 ${step === n ? "bg-white text-navy-800" : "bg-navy-100 text-navy-800"}`}>{n}</span>
            {t}
          </button>
        ))}
        <span className="w-3" />
        {(["U", "S"] as Brand[]).map((b) => (
          <button key={b} type="button" className={`btn ${brand === b ? "btn-primary" : ""}`} onClick={() => setBrand(b)}>
            {b === "U" ? "유투엠 (초중등)" : "스터디킬러 (고등)"}
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-semibold text-alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setError(null)}>
            닫기
          </button>
        </div>
      ) : null}
      {toast ? <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-navy-900 px-5 py-3 text-sm font-bold text-white shadow-lg">{toast}</div> : null}

      {!data || data.month !== month ? (
        <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : step === 1 ? (
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1">
            <AppCalendar data={data} brand={brand} sel={sel2} onSel={setSel} />
            <p className="mt-2 text-xs text-muted">
              <Tag kind="off">휴강</Tag> · <Tag kind="part">일부 반 휴강</Tag> · <Tag kind="open">★정상수업★</Tag> · <Tag kind="mv">보충 · 옮김</Tag> · 색 막대 = 학원 행사 ·{" "}
              <b className="text-alert">빨간 글씨</b> = 학교 시험(학사일정에서 자동) — <b>휴강은 유투엠 · 스킬 같음</b>. 학원 버튼은 행사 · 안내문만 바뀌어요.
            </p>
          </div>
          <div className="w-[380px] shrink-0 space-y-3">
            <DayPanel data={data} date={sel2} brand={brand} act={act} />
            <EventsCard data={data} brand={brand} act={act} />
          </div>
        </div>
      ) : step === 2 ? (
        <CountTable data={data} brand={brand} act={act} goStep1={() => setStep(1)} />
      ) : (
        <PosterStep data={data} brand={brand} act={act} setError={setError} setToast={setToast} />
      )}
    </div>
  );
}

function Tag({ kind, children }: { kind: "off" | "part" | "open" | "cand" | "mv"; children: React.ReactNode }) {
  const cls = {
    off: "bg-navy-800 text-white",
    part: "border border-late bg-late-soft text-late",
    open: "bg-present-soft text-present",
    cand: "border border-dashed border-alert bg-white text-alert",
    mv: "bg-srpink-soft text-srpink",
  }[kind];
  return <span className={`mt-0.5 inline-block rounded px-1.5 py-px text-[11px] font-extrabold ${cls}`}>{children}</span>;
}

/* ---------------------------------------------------------------- 1. 달력 */

function AppCalendar({ data, brand, sel, onSel }: { data: ScheduleData; brand: Brand; sel: string; onSel: (d: string) => void }) {
  const c = data.closures;
  const names = useMemo(() => new Map(data.allClasses.map((x) => [x.id, x.name])), [data]);
  const mine = useMemo(() => new Set(data.allClasses.filter((x) => x.brand === brand).map((x) => x.id)), [data, brand]);
  const events = data.events.filter((e) => e.brand === brand);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="grid grid-cols-7 border-b border-line bg-navy-50 text-center text-xs font-bold text-muted">
        {[...DOW].map((x, i) => (
          <div key={x} className={`py-1.5 ${i === 0 ? "text-alert" : i === 6 ? "text-present" : ""}`}>
            {x}
          </div>
        ))}
      </div>
      {monthWeeks(data.month).map((wk) => {
        const bars = weekBars(events, wk.start);
        const lanes = Math.max(0, ...bars.map((b) => b.lane + 1));
        return (
          <div key={wk.start} className="relative grid grid-cols-7">
            {wk.days.map((d, i) => {
              if (!d) return <div key={i} className="border-b border-r border-line bg-canvas" style={{ minHeight: 120 }} />;
              const day = dayOf(c, d);
              const holi = holidayOf(d);
              const part = c.classOff.filter((x) => x.date === d);
              const moves = c.moves.filter((m) => (m.toDate === d || m.fromDate === d) && mine.has(m.classId));
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onSel(d)}
                  className={`border-b border-r border-line px-1.5 pt-1 text-left align-top hover:bg-navy-50 ${d === sel ? "outline outline-2 -outline-offset-2 outline-navy-800" : ""} ${day?.off ? "bg-navy-50" : ""}`}
                  style={{ minHeight: 120, paddingBottom: 6 + lanes * 19 }}
                >
                  <div className={`text-sm font-extrabold ${i === 0 || holi ? "text-alert" : i === 6 ? "text-present" : "text-ink"}`}>
                    {Number(d.slice(8))}
                    {holi ? <span className="ml-1 text-[11px]">{holi}</span> : null}
                    {d === data.today ? <span className="ml-1 text-[11px] text-now">오늘</span> : null}
                  </div>
                  <div className="flex flex-col items-start">
                    {day?.off ? <Tag kind="off">휴강{day.memo ? ` · ${day.memo}` : ""}</Tag> : null}
                    {!day?.off && part.length ? <Tag kind="part">{part.map((x) => names.get(x.classId)).join("·")} 휴강</Tag> : null}
                    {day?.open ? <Tag kind="open">★정상수업★</Tag> : null}
                    {holi && !day ? <Tag kind="cand">휴강? 정하기</Tag> : null}
                    {moves.map((m) => (
                      <Tag key={`${m.id}-${m.toDate === d}`} kind="mv">
                        {names.get(m.classId)}{" "}
                        {m.kind === "EXTRA" ? `= ${monNo(m.countMonth)}월 보충` : m.fromDate === d ? `→ ${mdw(m.toDate)}` : `← ${mdw(m.fromDate!)}`}
                      </Tag>
                    ))}
                    {examLines(data.exams, d, brand === "S" ? ["H"] : ["M"]).map((t) => (
                      <span key={t} className="text-[11px] font-bold text-alert">
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
            {bars.map((b) => (
              <div
                key={`${b.ev.id}-${wk.start}`}
                className="pointer-events-none absolute flex items-center justify-center overflow-hidden whitespace-nowrap rounded text-[11px] font-extrabold text-ink"
                style={{
                  left: `calc(${(b.c0 / 7) * 100}% + 3px)`,
                  width: `calc(${((b.c1 - b.c0 + 1) / 7) * 100}% - 6px)`,
                  bottom: 4 + (lanes - 1 - b.lane) * 19,
                  height: 17,
                  background: b.ev.color,
                }}
              >
                {b.ev.emoji ? `${b.ev.emoji} ` : ""}
                {b.ev.title}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- 1. 날짜 패널 */

const LEVEL_BTNS: [string, (x: ScheduleData["allClasses"][number]) => boolean][] = [
  ["초등 전체", (x) => x.level === "초등" && x.kind !== "IND"],
  ["중등 전체", (x) => x.level === "중등" && x.kind !== "IND"],
  ["고등 전체", (x) => x.level === "고등"],
  ["개별반 전체", (x) => x.kind === "IND"],
];

function DayPanel({ data, date, brand, act }: { data: ScheduleData; date: string; brand: Brand; act: Act }) {
  const c = data.closures;
  const w = dowOf(date);
  const day = dayOf(c, date);
  const holi = holidayOf(date);
  const off = isAllOff(c, date);
  const todays = data.allClasses.filter((x) => x.days.includes(w));
  const partIds = new Set(c.classOff.filter((x) => x.date === date).map((x) => x.classId));
  const [memo, setMemo] = useState(day?.memo ?? "");
  const [form, setForm] = useState<"EXTRA" | "MOVE" | null>(null);
  useEffect(() => {
    setMemo(day?.memo ?? "");
    setForm(null);
  }, [date, day?.memo]);

  const setDay = (o: boolean) => void act({ action: "DAY", date, off: o, open: !o && !!holi, memo: memo || null }, o ? `${mdw(date)} 전체 휴강` : `${mdw(date)} 수업함`);
  const setPart = (ids: Set<number>) => void act({ action: "CLASS_OFF", date, classIds: [...ids], memo: null });
  const moves = c.moves.filter((m) => m.toDate === date || m.fromDate === date);
  const names = new Map(data.allClasses.map((x) => [x.id, x.name]));

  return (
    <div className="card space-y-2 p-4 text-sm">
      <h3 className="text-base font-extrabold text-navy-900">
        {mdwLong(date)} {holi ? <span className="text-alert">· {holi}</span> : null}
      </h3>
      <p className="text-xs text-muted">이 날 수업 반 {todays.length}개 (유투엠 + 스킬)</p>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className={`btn justify-center ${!off ? "btn-primary" : ""}`} onClick={() => setDay(false)}>
          수업함{holi ? " (★정상수업)" : ""}
        </button>
        <button type="button" className={`btn justify-center ${off ? "btn-primary" : ""}`} onClick={() => setDay(true)}>
          전체 휴강
        </button>
      </div>
      {off ? (
        <div className="flex gap-1.5">
          <input className="field flex-1" placeholder={`휴강 이름 (비우면 ${holi ?? "휴강"})`} value={memo} onChange={(e) => setMemo(e.target.value)} />
          <button type="button" className="btn" onClick={() => void act({ action: "DAY", date, off: true, open: false, memo: memo || null }, "저장")}>
            저장
          </button>
        </div>
      ) : (
        <>
          <div className="label mt-2">일부 반만 휴강</div>
          <div className="flex flex-wrap gap-1">
            {LEVEL_BTNS.map(([t, f]) => {
              const ids = todays.filter(f).map((x) => x.id);
              const on = ids.length > 0 && ids.every((id) => partIds.has(id));
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!ids.length}
                  className={`btn px-2 py-0.5 text-xs ${on ? "btn-primary" : ""}`}
                  onClick={() => {
                    const next = new Set(partIds);
                    for (const id of ids) on ? next.delete(id) : next.add(id);
                    setPart(next);
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {todays.length === 0 ? <span className="text-muted">수업 없음</span> : null}
            {todays.map((x) => (
              <label key={x.id} className={`flex items-center gap-1.5 rounded px-1 text-[13px] ${partIds.has(x.id) ? "bg-late-soft font-bold" : ""}`}>
                <input
                  type="checkbox"
                  checked={partIds.has(x.id)}
                  onChange={(e) => {
                    const next = new Set(partIds);
                    e.target.checked ? next.add(x.id) : next.delete(x.id);
                    setPart(next);
                  }}
                />
                <span className="truncate">{x.name}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <div className="label mt-2">보충 · 옮김</div>
      {moves.map((m) => (
        <div key={m.id} className="flex items-center gap-1.5 rounded bg-srpink-soft px-2 py-1 text-xs">
          <b className="flex-1">
            {names.get(m.classId)} ·{" "}
            {m.kind === "EXTRA" ? `${mdw(m.toDate)} = ${monNo(m.countMonth)}월 보충 수업` : `${mdw(m.fromDate!)} 수업 → ${mdw(m.toDate)}`}
          </b>
          <button type="button" className="btn btn-ghost px-1.5 py-0 text-xs" onClick={() => void act({ action: "MOVE_DEL", id: m.id }, "지움")}>
            🗑
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        <button type="button" className={`btn px-2 py-0.5 text-xs ${form === "EXTRA" ? "btn-primary" : ""}`} onClick={() => setForm(form === "EXTRA" ? null : "EXTRA")}>
          ＋ 이 날 보충 수업
        </button>
        <button type="button" className={`btn px-2 py-0.5 text-xs ${form === "MOVE" ? "btn-primary" : ""}`} onClick={() => setForm(form === "MOVE" ? null : "MOVE")}>
          ＋ 이 날 수업 다른 날로 옮기기
        </button>
      </div>
      {form ? <MoveForm key={`${form}-${date}`} data={data} date={date} brand={brand} kind={form} act={act} done={() => setForm(null)} /> : null}
      <p className="text-xs text-muted">휴강 · 옮겨 간 날 = 출결 팝업 · 알림음 · SR · 숙제검사 칸 · 결석 없음 (이미 열린 오늘 출결도 닫힘)</p>
    </div>
  );
}

function MoveForm({ data, date, brand, kind, act, done }: { data: ScheduleData; date: string; brand: Brand; kind: "EXTRA" | "MOVE"; act: Act; done: () => void }) {
  const w = dowOf(date);
  const list = data.classes.filter((x) => x.brand === brand && (kind === "EXTRA" || x.regDays.includes(w)));
  const [ids, setIds] = useState<Set<number>>(new Set());
  const [countMonth, setCountMonth] = useState(shiftMonth(monthOf(date), -1));
  const [to, setTo] = useState("");
  const submit = async () => {
    const r = await act(
      kind === "EXTRA"
        ? { action: "MOVE_ADD", kind, classIds: [...ids], fromDate: null, toDate: date, countMonth }
        : { action: "MOVE_ADD", kind, classIds: [...ids], fromDate: date, toDate: to, countMonth: null },
      kind === "EXTRA" ? "보충 수업 넣음" : "옮김 넣음",
    );
    if (r !== false) done();
  };
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-canvas p-2">
      <div className="text-xs font-bold">{kind === "EXTRA" ? `${mdw(date)}에 보충 수업할 반` : `${mdw(date)} 수업을 옮길 반`}</div>
      <div className="grid max-h-36 grid-cols-2 gap-x-2 overflow-auto">
        {list.length === 0 ? <span className="text-xs text-muted">이 날 수업하는 반이 없어요</span> : null}
        {list.map((x) => (
          <label key={x.id} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={ids.has(x.id)}
              onChange={(e) => {
                const n = new Set(ids);
                e.target.checked ? n.add(x.id) : n.delete(x.id);
                setIds(n);
              }}
            />
            {x.name} <span className="text-muted">{daysLabel(x.regDays)}</span>
          </label>
        ))}
      </div>
      {kind === "EXTRA" ? (
        <label className="flex items-center gap-1.5 text-xs">
          몇 월 횟수?
          <select className="field py-0.5 text-xs" value={countMonth} onChange={(e) => setCountMonth(e.target.value)}>
            {[-1, 0, 1].map((n) => {
              const m = shiftMonth(monthOf(date), n);
              return (
                <option key={m} value={m}>
                  {monNo(m)}월{n === -1 ? " (지난달 모자란 것)" : n === 0 ? " (이 달)" : " (다음 달 미리)"}
                </option>
              );
            })}
          </select>
        </label>
      ) : (
        <label className="flex items-center gap-1.5 text-xs">
          옮길 날짜
          <input type="date" className="field py-0.5 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          <span className="text-muted">(횟수는 {monNo(monthOf(date))}월)</span>
        </label>
      )}
      <button type="button" className="btn btn-primary w-full justify-center py-1 text-xs" disabled={!ids.size || (kind === "MOVE" && !to)} onClick={() => void submit()}>
        넣기
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 1. 행사 */

type Draft = Omit<SchedEvent, "id" | "orderNo"> & { id: number | null };
const emptyDraft = (brand: Brand, month: string): Draft => ({
  id: null,
  brand,
  title: "",
  start: `${month}-01`,
  end: `${month}-01`,
  color: SCHED_EVENT_COLORS[0],
  emoji: null,
  dy: 0,
  ex: 0,
  ey: 0,
  es: 30,
  classId: null,
  inNote: false,
});

function EventsCard({ data, brand, act }: { data: ScheduleData; brand: Brand; act: Act }) {
  const confirm = useConfirm();
  const events = data.events.filter((e) => e.brand === brand);
  const [draft, setDraft] = useState<Draft | null>(null);
  const names = new Map(data.allClasses.map((x) => [x.id, x.name]));
  const save = (e: SchedEvent | Draft, patch: Partial<Draft>, ok?: string) => act({ action: "EVENT_SAVE", event: { ...e, ...patch } }, ok);
  const range = (e: { start: string; end: string }) =>
    e.start === e.end ? mdw(e.start) : `${mdw(e.start)} ~ ${monthOf(e.start) === monthOf(e.end) ? `${Number(e.end.slice(8))}일` : mdw(e.end)}`;
  return (
    <div className="card space-y-1.5 p-4 text-sm">
      <h3 className="text-base font-extrabold text-navy-900">
        🎨 이 달 행사 <span className="text-xs font-normal text-muted">({BRAND_LABEL[brand]})</span>
      </h3>
      {events.length === 0 ? <p className="text-xs text-muted">행사가 없어요.</p> : null}
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-1 border-b border-dashed border-line py-1 text-xs">
          <select className="field w-11 px-0.5 py-0.5" style={{ background: e.color }} value={e.color} onChange={(x) => void save(e, { color: x.target.value })}>
            {[...new Set([...SCHED_EVENT_COLORS, e.color])].map((col) => (
              <option key={col} value={col} style={{ background: col }}>
                ■
              </option>
            ))}
          </select>
          {brand === "U" ? (
            <select className="field w-12 px-0.5 py-0.5" value={e.emoji ?? ""} onChange={(x) => void save(e, { emoji: x.target.value || null })}>
              {[...new Set([...EMOJIS, e.emoji ?? ""])].map((x) => (
                <option key={x} value={x}>
                  {x || "없음"}
                </option>
              ))}
            </select>
          ) : null}
          <b className="min-w-0 flex-1 truncate" title={e.title}>
            {e.title}
          </b>
          {e.classId ? <span className="rounded-full bg-navy-50 px-1.5">{names.get(e.classId)}</span> : null}
          {e.inNote ? <span title="안내 글에 한 줄">📝</span> : null}
          <span className="text-muted">{range(e)}</span>
          <button type="button" title="안내문에서 막대 위로" className="btn px-1 py-0 text-[11px]" onClick={() => void save(e, { dy: e.dy - 4 })}>
            ▲
          </button>
          <button type="button" title="안내문에서 막대 아래로" className="btn px-1 py-0 text-[11px]" onClick={() => void save(e, { dy: e.dy + 4 })}>
            ▼
          </button>
          <button type="button" className="btn btn-ghost px-1 py-0" onClick={() => setDraft({ ...e })}>
            ✏️
          </button>
          <button
            type="button"
            className="btn btn-ghost px-1 py-0"
            onClick={async () => {
              if (await confirm({ title: "행사를 지울까요?", message: `${e.title} (${range(e)})`, confirmText: "지우기", danger: true })) void act({ action: "EVENT_DEL", id: e.id }, "지움");
            }}
          >
            🗑
          </button>
        </div>
      ))}
      {draft ? (
        <div className="space-y-1.5 rounded-lg border border-line bg-canvas p-2 text-xs">
          <input className="field w-full" placeholder="행사 이름 (예: 월말평가)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus />
          <div className="flex items-center gap-1">
            <input type="date" className="field py-0.5 text-xs" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value, end: draft.end < e.target.value ? e.target.value : draft.end })} />~
            <input type="date" className="field py-0.5 text-xs" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {SCHED_EVENT_COLORS.map((col) => (
              <button
                key={col}
                type="button"
                className={`h-5 w-5 rounded-full border ${draft.color === col ? "border-navy-800 ring-2 ring-navy-800" : "border-line"}`}
                style={{ background: col }}
                onClick={() => setDraft({ ...draft, color: col })}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {brand === "U" ? (
              <select className="field py-0.5 text-xs" value={draft.emoji ?? ""} onChange={(e) => setDraft({ ...draft, emoji: e.target.value || null })}>
                {EMOJIS.map((x) => (
                  <option key={x} value={x}>
                    {x || "이모지 없음"}
                  </option>
                ))}
              </select>
            ) : null}
            <select className="field py-0.5 text-xs" value={draft.classId ?? ""} onChange={(e) => setDraft({ ...draft, classId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">모든 반</option>
              {data.classes
                .filter((x) => x.brand === brand)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}만
                  </option>
                ))}
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={draft.inNote} onChange={(e) => setDraft({ ...draft, inNote: e.target.checked })} />
              안내 글에도 한 줄
            </label>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn btn-primary flex-1 justify-center py-1 text-xs"
              disabled={!draft.title.trim()}
              onClick={async () => {
                if ((await save(draft, {}, draft.id ? "고침" : "행사 넣음")) !== false) setDraft(null);
              }}
            >
              {draft.id ? "고치기" : "넣기"}
            </button>
            <button type="button" className="btn py-1 text-xs" onClick={() => setDraft(null)}>
              취소
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1 pt-1">
        <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setDraft(emptyDraft(brand, data.month))}>
          ＋ 행사 추가
        </button>
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          disabled={!data.prevEventCount[brand]}
          onClick={() => void act({ action: "EVENT_COPY", brand, month: data.month }, "지난달 행사 복사함 (같은 이름 · 날짜는 건너뜀)")}
        >
          📋 지난달 행사 복사 ({data.prevEventCount[brand]})
        </button>
      </div>
      <p className="text-xs text-muted">
        색(■)과 {brand === "U" ? "이모지, " : ""}▲▼(안내문 막대 위치 — 안내문에서 끌어도 됨)를 고르고, 기간이면 막대가 이어져요. 「안내 글에도 한 줄」 = 안내문 아래 글에 「■ 행사 : 날짜」.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 2. 반별 횟수 */

function CountTable({ data, brand, act, goStep1 }: { data: ScheduleData; brand: Brand; act: Act; goStep1: () => void }) {
  const list = data.classes.filter((x) => x.brand === brand);
  const next = monNo(shiftMonth(data.month, 1));
  return (
    <div className="flex items-start gap-5">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">반</th>
                <th className="px-3 py-2">요일</th>
                <th className="px-3 py-2">{monNo(data.month)}월 수업</th>
                <th className="px-3 py-2">빠진 날 · 보충</th>
                <th className="px-3 py-2">정한 횟수</th>
                {brand === "S" ? <th className="px-3 py-2">수강료 (안내문에 자동)</th> : null}
                <th className="px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const k = countOf(data.closures, c, data.month, data.carries);
                const carry = data.carries.find((x) => x.classId === c.id && x.month === data.month)?.delta ?? 0;
                const diffs = k.totals.map((t) => t - k.target);
                const diff = diffs.find((d) => d !== 0) ?? 0;
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-3 py-2 font-bold">{c.name}</td>
                    <td className="px-3 py-2">
                      {daysLabel(c.regDays)}
                      {c.indDays.length ? " + 개별 금·토" : ""}
                      {c.freeDays.length ? (
                        <span className="ml-1 rounded-full bg-srpink-soft px-2 text-[11px] font-bold text-srpink">+ {c.freeDays.map((f) => `${DOW[f.day]} ${f.label}`).join(" · ")} 무료</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <b>
                        {k.indFri !== k.indSat && c.indDays.length ? `금 ${k.reg + k.indFri}회 · 토 ${k.reg + k.indSat}회` : `${k.totals[0]}회`}
                      </b>
                      {c.indDays.length ? <span className="ml-1 text-xs text-muted">(정규 {k.reg} + 개별)</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {k.off ? <span className="mr-1 rounded-full bg-navy-50 px-2">휴강 {k.off}</span> : null}
                      {k.fromOther ? <span className="mr-1 rounded-full bg-srpink-soft px-2 text-srpink">다른 달 보충 {k.fromOther}</span> : null}
                      {k.otherMonth ? <span className="rounded-full bg-srpink-soft px-2 text-srpink">다른 달 횟수 {k.otherMonth}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      월 {k.target}회{k.carryIn ? <span className="ml-1 text-xs text-muted">(지난달에서 {k.carryIn > 0 ? `+${k.carryIn}` : k.carryIn})</span> : null}
                    </td>
                    {brand === "S" ? (
                      <td className="px-3 py-2">
                        {c.fee ? (
                          <>
                            {feeLabel(c.fee)}/회 <span className="text-xs text-muted">= {feeLabel(c.fee * c.target)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-alert">학년을 몰라요 (반 학년에 고1~3)</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      {carry ? (
                        <span className="flex items-center gap-1">
                          <b className="text-ok">✓ {next}월로 넘김 ({carry > 0 ? `+${carry}` : carry})</b>
                          <button type="button" className="btn px-1.5 py-0 text-xs" onClick={() => void act({ action: "CARRY", classId: c.id, month: data.month, delta: 0 }, "넘김 취소")}>
                            취소
                          </button>
                        </span>
                      ) : diff === 0 ? (
                        <b className="text-ok">✓ 맞음</b>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          <b className="text-alert">{diff > 0 ? `${diff}회 많음` : `${-diff}회 모자람`}</b>
                          <button type="button" className="btn px-1.5 py-0 text-xs" onClick={goStep1}>
                            {diff > 0 ? "휴강 고르기" : "보충일 넣기"}
                          </button>
                          <button type="button" className="btn px-1.5 py-0 text-xs" onClick={() => void act({ action: "CARRY", classId: c.id, month: data.month, delta: diff }, `${next}월로 넘김`)}>
                            {next}월로 넘기기
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          <b>합계만 맞으면 OK</b> (정규 · 개별 비율 상관없음). 정한 횟수는 자동 — 초3 · 피팅 · 고등 8회 / 나머지 12회(정규 + 개별 금 또는 토). 고등 수강료도 자동(고1 6만 · 고2 · 3 6.5만/회).
          누적오답 같은 무료 수업은 세지 않고 달력에만.
        </p>
      </div>
      <div className="card w-[340px] shrink-0 space-y-1 p-4 text-sm">
        <h3 className="font-extrabold text-navy-900">남거나 모자라면</h3>
        <ul className="list-disc space-y-1 pl-4 text-[13px]">
          <li>
            <b>휴강 고르기</b>: 1단계 달력에서 날짜 → 그 반만 휴강
          </li>
          <li>
            <b>보충</b>: 1단계 날짜 → 「＋ 이 날 보충 수업」 (몇 월 횟수인지 고름)
          </li>
          <li>
            <b>옮김</b>: 1단계 날짜 → 「＋ 다른 날로 옮기기」 — 횟수는 그대로
          </li>
          <li>
            <b>{next}월로 넘기기</b>: {next}월 정한 횟수에서 빼고 더함
          </li>
        </ul>
      </div>
    </div>
  );
}
