"use client";

// SR 관리 — ① 실시간 좌석 현황 ② 요일별 자리 배치.
// 학생은 그 반이 SR을 쓰는 모든 요일에 같은 자리. 자리 바꾸기 = 데스크·관리자, 선생님은 🙋 자리 요청.
// 임시 자리 · 🏠 하원 · 📄 미션지 = 데스크·관리자. 🧹 월초 자리 정리 = 관리자 (매달 1일 자동).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../Modal";
import TimeSelect from "../TimeSelect";
import { useConfirm } from "../ConfirmDialog";
import { IconPrinter } from "../Icons";
import SeatMap, { type SeatMark } from "./SeatMap";
import PrintSheet from "./PrintSheet";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { can } from "@/lib/perm";
import { playAlarm } from "@/lib/alarm";
import { classColorMap, LEVEL_COLOR, type ClassColor } from "@/lib/colors";
import { LEVEL_NAME, movableSeatsFor, occupantsAt, seatBlocker, seatCol, type SeatUse } from "@/lib/sr";
import { DAY_LABELS, clockLabel, fmtTime, minutesOfDay, monthDay, rangeLabel, weekDateOf } from "@/lib/time";
import { teacherLabel, type SessionUser } from "@/lib/types";
import type { SrClass, SrSnapshot } from "@/lib/repo/sr";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
type Move = { classId: number; studentId: number; name: string };
type AdhocDraft = { name: string; kind: string; date: string; day: number; start: number; end: number };

export default function SrClient({ user }: { user: SessionUser }) {
  const confirm = useConfirm();
  const desk = can(user, "sr.desk");
  const mover = can(user, "sr.move");
  const requester = !mover && can(user, "sr.request");

  const [view, setView] = useState<"live" | "day">("live");
  const [live, setLive] = useState<SrSnapshot | null>(null);
  const [daySnap, setDaySnap] = useState<SrSnapshot | null>(null);
  const [day, setDay] = useState(() => new Date().getDay());
  const [slot, setSlot] = useState(0);
  const [now, setNow] = useState(() => minutesOfDay(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [adhoc, setAdhoc] = useState<AdhocDraft | null>(null);
  const [student, setStudent] = useState<Move | null>(null);
  const [ask, setAsk] = useState<{ seat: string } | null>(null);
  const [adhocForm, setAdhocForm] = useState(false);
  const [print, setPrint] = useState(false);
  const waitCount = useRef<number | null>(null);

  const dayDate = weekDateOf(day);

  const loadLive = useCallback(async () => {
    try {
      const s = await apiGet<SrSnapshot>("/api/sr");
      setLive(s);
      // 새 자리 요청이 오면 데스크에 짧게 알림음
      const wait = s.requests.filter((r) => r.state === "WAIT").length;
      if (mover && waitCount.current !== null && wait > waitCount.current) playAlarm(1.5);
      waitCount.current = wait;
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [mover]);
  const loadDay = useCallback(async () => {
    try {
      setDaySnap(await apiGet<SrSnapshot>(`/api/sr?date=${dayDate}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [dayDate]);
  const reload = useCallback(async () => {
    await Promise.all([loadLive(), view === "day" ? loadDay() : Promise.resolve()]);
  }, [loadLive, loadDay, view]);

  useEffect(() => {
    void loadLive();
    const t = setInterval(() => {
      void loadLive();
      setNow(minutesOfDay(new Date()));
    }, 5000);
    return () => clearInterval(t);
  }, [loadLive]);
  useEffect(() => {
    if (view === "day") void loadDay();
  }, [view, loadDay]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const act = async (body: Record<string, unknown>, ok?: string) => {
    setError(null);
    try {
      await apiPost("/api/sr/action", body);
      await reload();
      if (ok) setToast(ok);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  const snapFor = view === "live" ? live : daySnap;
  const cls = (snap: SrSnapshot | null, id: number) => snap?.classes.find((c) => c.id === id);
  const nameOf = (snap: SrSnapshot, classId: number, studentId: number) => cls(snap, classId)?.members.find((m) => m.id === studentId)?.name ?? "";

  const pack = async () => {
    const yes = await confirm({
      title: "🧹 월초 자리 정리",
      message: "퇴원 등으로 생긴 빈자리를 없애고, 반마다 쓰던 열 안에서 앞자리부터 다시 채워요. 사람이 옮긴 자리는 그대로 둬요. (매달 1일에는 저절로 해요)",
      confirmText: "정리하기",
    });
    if (yes) void act({ action: "PACK" }, "빈자리를 앞으로 당겨 정리했어요 (반마다 쓰던 열은 그대로)");
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["live", "실시간 좌석 현황"],
              ["day", "요일별 자리 배치"],
            ] as const
          ).map(([k, n]) => (
            <button
              key={k}
              type="button"
              className={`btn ${view === k ? "btn-primary" : ""}`}
              onClick={() => {
                setView(k);
                setMove(null);
                setAdhoc(null);
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {desk ? (
            <button type="button" className="btn" onClick={() => setAdhocForm(true)}>
              ＋ 임시 자리 잡기
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => setPrint(true)} disabled={!live}>
            <IconPrinter className="h-4 w-4" />
            좌석표 인쇄 (PDF)
          </button>
          {can(user, "sr.pack") ? (
            <button type="button" className="btn" onClick={() => void pack()}>
              🧹 월초 자리 정리
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

      {live ? <RequestPanel user={user} snap={live} act={act} /> : null}

      {!snapFor ? (
        <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : view === "live" ? (
        <LiveView
          user={user}
          snap={snapFor}
          now={now}
          act={act}
          onStudent={(o) => o.classId && o.studentId && setStudent({ classId: o.classId, studentId: o.studentId, name: o.name })}
          onAdhoc={async (o) => {
            if (!desk || !o.adhocId) return;
            if (await confirm({ title: "임시 자리를 지울까요?", message: `${o.name} · ${o.label} · ${rangeLabel(o.start, o.end)} · ${o.seat}`, confirmText: "지우기" }))
              void act({ action: "ADHOC_DEL", id: o.adhocId });
          }}
        />
      ) : (
        <DayView
          user={user}
          snap={snapFor}
          day={day}
          setDay={(d) => {
            setDay(d);
            setSlot(0);
          }}
          slot={slot}
          setSlot={setSlot}
          move={move}
          adhoc={adhoc}
          cancelMode={() => {
            setMove(null);
            setAdhoc(null);
          }}
          onPickMove={(seat) => {
            if (!move) return;
            if (mover)
              void act({ action: "MOVE", classId: move.classId, studentId: move.studentId, seat }, `${move.name} → ${seat} (모든 요일 같은 자리로)`).then((ok) => ok && setMove(null));
            else setAsk({ seat });
          }}
          onPickAdhoc={(seat) => {
            if (!adhoc) return;
            void act({ action: "ADHOC", ...adhoc, seat }, `${adhoc.name} → ${seat} (${adhoc.kind})`).then((ok) => ok && setAdhoc(null));
          }}
          onStudent={(o) => o.classId && o.studentId && setStudent({ classId: o.classId, studentId: o.studentId, name: o.name })}
        />
      )}

      {student && live ? (
        <StudentModal
          user={user}
          snap={live}
          target={student}
          onClose={() => setStudent(null)}
          onLeave={() => void act({ action: "LEAVE", classId: student.classId, studentId: student.studentId }).then(() => setStudent(null))}
          onMove={() => {
            const firstDay = live.blocks.filter((b) => b.classId === student.classId).map((b) => b.day).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))[0];
            setMove(student);
            setAdhoc(null);
            setStudent(null);
            setView("day");
            if (firstDay !== undefined) {
              setDay(firstDay);
              setSlot(0);
            }
          }}
        />
      ) : null}

      {ask && move ? (
        <AskSeatModal
          move={move}
          seat={ask.seat}
          from={live?.seats.find((s) => s.classId === move.classId && s.studentId === move.studentId)?.seat ?? null}
          className={cls(live, move.classId)?.name ?? ""}
          onClose={() => setAsk(null)}
          onSend={async (scope, reason) => {
            const ok = await act({ action: "REQUEST", classId: move.classId, studentId: move.studentId, seat: ask.seat, scope, reason }, "요청 보냄 — 데스크가 승인하면 바뀌어요");
            if (ok) {
              setAsk(null);
              setMove(null);
            }
          }}
        />
      ) : null}

      {adhocForm && live ? (
        <AdhocForm
          snap={live}
          initialDay={view === "day" ? day : new Date().getDay()}
          onClose={() => setAdhocForm(false)}
          onNext={(draft) => {
            setAdhocForm(false);
            setMove(null);
            setAdhoc(draft);
            setView("day");
            setDay(draft.day);
            setSlot(-1);
          }}
        />
      ) : null}

      {print && live ? <PrintSheet snap={live} onClose={() => setPrint(false)} /> : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white print:hidden">{toast}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ 공통 */

const colorsOf = (snap: SrSnapshot, day: number) => classColorMap(snap.dayClassIds[day] ?? []);
const columnsOf = (snap: SrSnapshot, classId: number) =>
  [...new Set(snap.seats.filter((s) => s.classId === classId).map((s) => seatCol(s.seat)))].sort().join("·");

function LogPanel({ snap }: { snap: SrSnapshot }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-[15px] font-bold">📝 자리 변경 기록</h3>
      {snap.log.length === 0 ? <p className="text-xs text-muted">아직 없어요. 누가 언제 바꿨는지 여기에 남아요.</p> : null}
      {snap.log.slice(0, 15).map((l, i) => (
        <div key={i} className="border-b border-line py-1 text-xs last:border-b-0">
          <span className="text-muted">
            {monthDay(l.date)} {clockLabel(l.atMin)}
          </span>{" "}
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** 🙋 자리 요청 — 데스크·관리자: 대기 중인 요청(승인/거절) / 선생님: 내가 보낸 요청 */
function RequestPanel({ user, snap, act }: { user: SessionUser; snap: SrSnapshot; act: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const mover = can(user, "sr.move");
  const list = mover ? snap.requests.filter((r) => r.state === "WAIT") : snap.requests.filter((r) => r.requestedBy === user.id).slice(0, 5);
  if (!list.length) return null;
  const ST = { WAIT: "⏳ 대기", OK: "✅ 승인", NO: "❌ 거절" };
  return (
    <div className="rounded-xl border border-srpink-soft bg-srpink-soft px-4 py-2.5 text-sm text-srpink">
      <b>🙋 자리 요청 {list.length}건</b>
      {list.map((r) => (
        <div key={r.id} className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-ink">
          <span>
            <b>{teacherLabel(r.requestedByName)}</b> · {r.className} <b>{r.studentName}</b> {r.fromSeat ?? "—"} → <b>{r.toSeat}</b> · {r.scope === "TODAY" ? "오늘만" : "계속"}
            {r.reason ? ` · ${r.reason}` : ""} <span className="text-muted">{clockLabel(r.atMin)}</span>
          </span>
          {mover ? (
            <span className="flex gap-1 whitespace-nowrap">
              <button type="button" className="btn btn-primary px-2.5 py-0.5 text-xs" onClick={() => void act({ action: "ANSWER", id: r.id, ok: true }, `✅ ${r.studentName} → ${r.toSeat}`)}>
                승인
              </button>
              <button type="button" className="btn px-2.5 py-0.5 text-xs" onClick={() => void act({ action: "ANSWER", id: r.id, ok: false }, "거절했어요")}>
                거절
              </button>
            </span>
          ) : (
            <b className="whitespace-nowrap">{ST[r.state]}</b>
          )}
        </div>
      ))}
    </div>
  );
}

/** 📄 미션지 한 줄 — 금·토 개별반 · 숙제반은 필요 없음 */
function MissionLine({ user, snap, c, act }: { user: SessionUser; snap: SrSnapshot; c: SrClass; act: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  if (!c.needsMission) return <div className="mb-1 text-[11px] text-muted">📄 {c.type === "HOMEWORK" ? "숙제반" : "개별반"} — 미션지 필요 없음</div>;
  const m = snap.missions.find((x) => x.classId === c.id);
  const t = teacherLabel(c.teacherName);
  const done = m?.state === "DONE";
  const doneText = m?.doneByKind === "TEACHER" ? `${t} 전달완료` : "받음";
  if (!can(user, "sr.desk")) {
    return done ? (
      <div className="mb-1 text-xs font-bold text-present">📄 미션지 ✅ {doneText}</div>
    ) : (
      <div className="mb-1 text-xs font-bold text-alert">📄 미션지 없음{m ? ` · 📣 ${t} 요청됨` : ""}</div>
    );
  }
  if (done)
    return (
      <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-present">
        📄 미션지 ✅ {doneText}
        <button type="button" className="btn px-1.5 py-0 text-[11px]" onClick={() => void act({ action: "MISSION", classId: c.id, kind: "CANCEL" })}>
          취소
        </button>
      </div>
    );
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <b className="text-alert">📄 미션지 없음</b>
      <button type="button" className="btn px-1.5 py-0.5 text-[11px]" onClick={() => void act({ action: "MISSION", classId: c.id, kind: "RECEIVE" })}>
        ✅ 받음
      </button>
      {m ? (
        <span className="text-muted">
          📣 {t} 요청함 ({clockLabel(m.requestedAt ?? 0)})
        </span>
      ) : (
        <button type="button" className="btn px-1.5 py-0.5 text-[11px] text-alert" disabled={!c.teacherId} onClick={() => void act({ action: "MISSION", classId: c.id, kind: "REQUEST" }, `${t} 미션지 요청`)}>
          📣 {t} 요청
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ ① 실시간 */

function LiveView({
  user,
  snap,
  now,
  act,
  onStudent,
  onAdhoc,
}: {
  user: SessionUser;
  snap: SrSnapshot;
  now: number;
  act: (b: Record<string, unknown>, ok?: string) => Promise<boolean>;
  onStudent: (o: SeatUse) => void;
  onAdhoc: (o: SeatUse) => void;
}) {
  const d = snap.day;
  const occ = occupantsAt(snap.dayUses, d, now);
  const colors = colorsOf(snap, d);
  const nowBlocks = snap.dayBlocks.filter((b) => b.start <= now && now < b.end).sort((a, b) => a.end - b.end);
  const next = snap.dayBlocks.filter((b) => b.start > now && b.start - now <= 30).sort((a, b) => a.start - b.start);
  const adhocNow = snap.adhoc.filter((a) => a.start <= now && now < a.end);
  const missing = [...nowBlocks, ...next].map((b) => snap.classes.find((c) => c.id === b.classId)!).filter((c) => c && c.needsMission && !snap.missions.find((m) => m.classId === c.id));
  const card = (b: (typeof snap.dayBlocks)[number], upcoming: boolean) => {
    const c = snap.classes.find((x) => x.id === b.classId);
    if (!c) return null;
    const col = colors.get(c.id);
    const left = b.end - now;
    const review = c.type === "REVIEW";
    return (
      <div key={`${c.id}-${b.start}`} className="mb-2 rounded-xl border border-line px-3 py-2.5" style={{ borderLeft: `5px solid ${col?.border ?? "var(--color-line)"}` }}>
        <MissionLine user={user} snap={snap} c={c} act={act} />
        <div className="flex justify-between">
          <b>{c.name}</b>
          {upcoming ? <span className="text-muted">{b.start - now}분 뒤 시작</span> : <span className={`font-extrabold ${left <= 20 ? "text-late" : ""}`}>{left}분 남음</span>}
        </div>
        <div className="text-xs text-muted">
          {rangeLabel(b.start, b.end)} · {c.members.length}명 · {columnsOf(snap, c.id) || "—"}열{review ? " · 다 끝내면 하원" : ""}
        </div>
        <div className="mt-1 text-xs">
          {c.members.map((m, i) => {
            const gone = snap.leave.find((l) => l.classId === c.id && l.studentId === m.id);
            const seat = snap.dayUses.find((u) => u.key === `${c.id}|${m.id}`)?.seat ?? snap.seats.find((s) => s.classId === c.id && s.studentId === m.id)?.seat;
            return (
              <span key={m.id}>
                {i ? " · " : ""}
                {gone && gone.atMin <= now ? (
                  <span className="text-muted">
                    {m.name} 🏠{clockLabel(gone.atMin)} 하원
                  </span>
                ) : (
                  <>
                    {m.name} <b>{seat ?? "자리없음"}</b>
                  </>
                )}
              </span>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <>
      {missing.length ? (
        <div className="flex items-center justify-between rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-bold text-alert">
          <span>
            📄 미션지 없음: <b>{missing.map((c) => c.name).join(", ")}</b>
          </span>
          {can(user, "sr.desk") ? (
            <button
              type="button"
              className="btn px-2.5 py-1 text-xs"
              onClick={async () => {
                for (const c of missing) if (c.teacherId) await act({ action: "MISSION", classId: c.id, kind: "REQUEST" });
              }}
            >
              📣 모두 요청
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start gap-4">
        <div className="card flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <b className="text-base">
              {DAY_LABELS[d]}요일 {fmtTime(now)} — 지금 SR룸
            </b>
            <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-bold">{occ.size} / 24석 사용 중</span>
          </div>
          <SeatMap occ={occ} colors={colors} now={now} onSeat={(o) => (o.adhocId ? onAdhoc(o) : onStudent(o))} />
          <p className="mt-2 text-xs text-muted">
            학생을 누르면 자리 정보 · {can(user, "sr.move") ? "자리 바꾸기" : "🙋 자리 요청"} · 10분 안에 끝나는 자리는 「곧 끝」 · 빗금 = 임시 자리
          </p>
        </div>
        <div className="w-[340px] shrink-0 space-y-3">
          <div className="card p-4">
            <h3 className="mb-2 text-[15px] font-bold">지금 SR 쓰는 반 ({nowBlocks.length})</h3>
            {nowBlocks.length === 0 ? <p className="text-sm text-muted">지금은 SR을 쓰는 반이 없어요.</p> : nowBlocks.map((b) => card(b, false))}
            {adhocNow.map((a) => (
              <div key={a.id} className="mb-2 rounded-xl border border-line px-3 py-2 text-sm">
                <b>📌 {a.name}</b>{" "}
                <span className="text-muted">
                  {a.kind} · {rangeLabel(a.start, a.end)} · {a.seat}
                </span>
              </div>
            ))}
          </div>
          <div className="card p-4">
            <h3 className="mb-2 text-[15px] font-bold">30분 안에 들어올 반</h3>
            {next.length === 0 ? <p className="text-sm text-muted">없어요.</p> : next.map((b) => card(b, true))}
          </div>
          <LogPanel snap={snap} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ ② 요일별 */

function DayView({
  user,
  snap,
  day,
  setDay,
  slot,
  setSlot,
  move,
  adhoc,
  cancelMode,
  onPickMove,
  onPickAdhoc,
  onStudent,
}: {
  user: SessionUser;
  snap: SrSnapshot;
  day: number;
  setDay: (d: number) => void;
  slot: number;
  setSlot: (i: number) => void;
  move: Move | null;
  adhoc: AdhocDraft | null;
  cancelMode: () => void;
  onPickMove: (seat: string) => void;
  onPickAdhoc: (seat: string) => void;
  onStudent: (o: SeatUse) => void;
}) {
  const colors = colorsOf(snap, day);
  const uses = snap.day === day ? snap.dayUses : [];
  // 시간 칸 — SR 시작·끝 시각으로 나눈다
  const slots = useMemo(() => {
    const pts = new Set<number>();
    for (const u of uses) {
      pts.add(u.start);
      pts.add(u.end);
    }
    const sorted = [...pts].sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (let i = 0; i < sorted.length - 1; i++) if (occupantsAt(uses, day, sorted[i]).size) out.push([sorted[i], sorted[i + 1]]);
    return out;
  }, [uses, day]);
  // 임시 자리를 고르는 중이면 그 시간이 들어 있는 칸으로
  const want = adhoc ? slots.findIndex(([s, e]) => s < adhoc.end && adhoc.start < e) : -1;
  const idx = slot >= 0 && slot < slots.length ? slot : want >= 0 ? want : 0;
  const [s, e] = slots[idx] ?? [null, null];
  const occ = s === null ? new Map<string, SeatUse>() : occupantsAt(uses, day, s);

  let mark: ((seat: string) => SeatMark | null) | undefined;
  let banner = null;
  if (move) {
    const key = `${move.classId}|${move.studentId}`;
    const mine = snap.seats.find((x) => x.classId === move.classId && x.studentId === move.studentId)?.seat;
    const blocks = snap.blocks.filter((b) => b.classId === move.classId);
    const movable = movableSeatsFor(snap.weekUses, blocks, key);
    mark = (seat) => {
      if (seat === mine)
        return {
          tone: "self",
          content: (
            <>
              <span className="mt-1.5 block text-sm font-extrabold">{move.name}</span>
              <span className="text-[11px]">지금 자리</span>
            </>
          ),
        };
      const who = movable.get(seat);
      return who
        ? { tone: "block", title: `쓰는 사람: ${who.name} (${who.label} ${DAY_LABELS[who.day]} ${rangeLabel(who.start, who.end)})`, content: <span className="mt-1.5 block text-[11px]">{who.name}</span> }
        : { tone: "pick", onClick: () => onPickMove(seat), content: <span className="mt-1.5 block text-sm font-extrabold">여기로</span> };
    };
    banner = (
      <div className="flex items-center justify-between rounded-xl border border-srpink-soft bg-srpink-soft px-4 py-2.5 text-sm font-bold text-srpink">
        <span>
          ↔ <b>{move.name}</b>({snap.classes.find((c) => c.id === move.classId)?.name}) {can(user, "sr.move") ? "자리 바꾸기" : "자리 요청 — 고른 자리를 데스크에 요청해요"} · 이 반이 SR을 쓰는{" "}
          <b>모든 요일·시간</b> 동안 비어 있는 자리만 분홍색이에요.
        </span>
        <button type="button" className="btn px-2.5 py-1 text-xs" onClick={cancelMode}>
          취소
        </button>
      </div>
    );
  } else if (adhoc) {
    mark = (seat) => {
      const who = seatBlocker(uses, day, seat, adhoc.start, adhoc.end);
      return who
        ? { tone: "block", title: `쓰는 사람: ${who.name} (${who.label} ${rangeLabel(who.start, who.end)})`, content: <span className="mt-1.5 block text-[11px]">{who.name}</span> }
        : { tone: "pick", onClick: () => onPickAdhoc(seat), content: <span className="mt-1.5 block text-sm font-extrabold">여기</span> };
    };
    banner = (
      <div className="flex items-center justify-between rounded-xl border border-srpink-soft bg-srpink-soft px-4 py-2.5 text-sm font-bold text-srpink">
        <span>
          📌 <b>{adhoc.name}</b> {adhoc.kind} {DAY_LABELS[adhoc.day]} {rangeLabel(adhoc.start, adhoc.end)} — 그 시간 내내 비어 있는 자리만 분홍색이에요. 회색 자리에 마우스를 올리면 누가 쓰는지 보여요.
        </span>
        <button type="button" className="btn px-2.5 py-1 text-xs" onClick={cancelMode}>
          취소
        </button>
      </div>
    );
  }

  const dayClasses = [...new Set(snap.blocks.filter((b) => b.day === day).map((b) => b.classId))];
  const over = snap.overflow.filter((o) => snap.blocks.some((b) => b.classId === o.classId && b.day === day));
  const t = new Date();
  const monthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() - t.getDate() < 3;
  return (
    <>
      {banner}
      {over.length ? (
        <div className="rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-bold text-alert">
          ⚠ 자리가 모자라 못 앉은 학생 {over.length}명:{" "}
          {over.map((o) => `${snap.classes.find((c) => c.id === o.classId)?.members.find((m) => m.id === o.studentId)?.name ?? ""}(${snap.classes.find((c) => c.id === o.classId)?.name ?? ""})`).join(", ")}
        </div>
      ) : null}
      {monthEnd ? <div className="rounded-xl border border-late bg-late-soft px-4 py-2.5 text-sm font-bold text-late">📅 다음 달 1일에 빈자리를 앞으로 당겨 정리해요 (월초 자리 정리).</div> : null}
      <div className="flex flex-wrap gap-1.5">
        {WEEK.map((x) => (
          <button key={x} type="button" className={`btn px-3 ${day === x ? "btn-primary" : ""}`} onClick={() => setDay(x)}>
            {DAY_LABELS[x]}
            <span className="text-[11px] font-normal opacity-70">{monthDay(weekDateOf(x))}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {snap.day !== day ? <span className="text-sm text-muted">불러오는 중…</span> : null}
        {snap.day === day && slots.length === 0 ? <span className="text-sm text-muted">이 요일에는 SR을 쓰는 반이 없어요.</span> : null}
        {slots.map(([a, b], i) => (
          <button key={a} type="button" className={`btn px-2.5 py-1 text-xs ${idx === i ? "btn-primary" : ""}`} onClick={() => setSlot(i)}>
            {rangeLabel(a, b)}
          </button>
        ))}
      </div>
      <div className="flex items-start gap-4">
        <div className="card flex-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <b className="text-base">
              {DAY_LABELS[day]}요일 {s !== null && e !== null ? rangeLabel(s, e) : ""}
            </b>
            <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-bold">{occ.size} / 24석</span>
          </div>
          <SeatMap occ={occ} colors={colors} mark={mark} onSeat={(o) => !o.adhocId && onStudent(o)} />
        </div>
        <div className="w-[340px] shrink-0 space-y-3">
          <div className="card p-4">
            <h3 className="mb-2 text-[15px] font-bold">이 요일 SR 반</h3>
            {dayClasses.length === 0 ? <p className="text-sm text-muted">없어요.</p> : null}
            {dayClasses.map((id) => (
              <Legend key={id} snap={snap} classId={id} day={day} color={colors.get(id)} />
            ))}
          </div>
          <LogPanel snap={snap} />
          <div className="card p-4">
            <h3 className="mb-2 text-[15px] font-bold">자리 정하는 규칙</h3>
            <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed">
              <li>
                학생은 그 반이 SR을 쓰는 <b>모든 요일에 같은 자리</b>
              </li>
              <li>
                <b>같은 반은 같은 열</b>, 앞자리(1번)부터. 6명이 넘으면 두 열로
              </li>
              <li>
                <b>고등과 초등이 같은 시간</b>이면 최대한 먼 열 (고등 D ↔ 초등 A), 중등은 가운데(B·C)
              </li>
              <li>
                퇴원으로 빈자리가 생겨도 다른 학생 자리는 그대로 — <b>매달 1일에 앞으로 당겨 정리</b>
              </li>
              <li>사람이 옮긴 자리는 다시 계산해도 그대로 둬요</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function Legend({ snap, classId, day, color }: { snap: SrSnapshot; classId: number; day: number; color?: ClassColor }) {
  const c = snap.classes.find((x) => x.id === classId);
  const b = snap.blocks.find((x) => x.classId === classId && x.day === day);
  if (!c || !b) return null;
  const today = snap.day === new Date().getDay() && day === snap.day;
  const m = snap.missions.find((x) => x.classId === classId);
  const mis = !c.needsMission ? null : !today ? <span title="미션지 필요">📄</span> : m?.state === "DONE" ? <span title="미션지 받음">📄✅</span> : <span title="미션지 없음" className="text-alert">📄❌</span>;
  return (
    <div className="flex items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-b-0">
      <span className="h-3.5 w-3.5 shrink-0 rounded border" style={{ background: color?.bg, borderColor: color?.border }} />
      <b>{c.name}</b>
      <span className="rounded px-1.5 text-[11px] font-extrabold text-white" style={{ background: LEVEL_COLOR[c.level] }}>
        {LEVEL_NAME[c.level][0]}
      </span>
      <span className="text-xs text-muted">
        {c.members.length}명 · {columnsOf(snap, c.id) || "—"}열 · {rangeLabel(b.start, b.end)}
      </span>
      {mis}
    </div>
  );
}

/* ------------------------------------------------------------ 팝업들 */

function StudentModal({
  user,
  snap,
  target,
  onClose,
  onLeave,
  onMove,
}: {
  user: SessionUser;
  snap: SrSnapshot;
  target: Move;
  onClose: () => void;
  onLeave: () => void;
  onMove: () => void;
}) {
  const c = snap.classes.find((x) => x.id === target.classId);
  const seat = snap.seats.find((s) => s.classId === target.classId && s.studentId === target.studentId);
  const todaySeat = snap.dayUses.find((u) => u.key === `${target.classId}|${target.studentId}`)?.seat;
  const blocks = snap.blocks.filter((b) => b.classId === target.classId).sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7));
  const others = snap.classes.filter((x) => x.id !== target.classId && x.members.some((m) => m.id === target.studentId)).map((x) => x.name);
  const review = c?.type === "REVIEW";
  const left = snap.leave.some((l) => l.classId === target.classId && l.studentId === target.studentId);
  return (
    <Modal
      open
      width={520}
      title={target.name}
      subtitle={`${c?.name ?? ""}${others.length ? ` · 다른 반 ${others.join(", ")}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {review && can(user, "sr.desk") ? (
            <button type="button" className={`btn ${left ? "" : "btn-primary"}`} onClick={onLeave}>
              {left ? "하원 취소" : "🏠 하원"}
            </button>
          ) : null}
          {can(user, "sr.move") || can(user, "sr.request") ? (
            <button type="button" className="btn border-srpink bg-srpink text-white hover:bg-srpink" onClick={onMove}>
              {can(user, "sr.move") ? "↔ 자리 바꾸기" : "🙋 자리 요청"}
            </button>
          ) : null}
        </>
      }
    >
      <div className="text-[28px] font-extrabold text-navy-800">
        {seat?.seat ?? "자리 없음"}
        {seat?.manual ? <span className="ml-2 rounded-full border border-line px-2 py-0.5 align-middle text-xs font-bold">사람이 옮긴 자리</span> : null}
        {todaySeat && todaySeat !== seat?.seat ? <span className="ml-2 align-middle text-sm text-srpink">오늘만 {todaySeat}</span> : null}
      </div>
      <table className="mt-2.5 w-full text-sm">
        <thead>
          <tr className="bg-navy-50 text-left text-xs text-muted">
            <th className="px-2.5 py-2">요일</th>
            <th className="px-2.5 py-2">SR 시간</th>
            <th className="px-2.5 py-2">자리</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.day} className="border-t border-line">
              <td className="px-2.5 py-2">{DAY_LABELS[b.day]}</td>
              <td className="px-2.5 py-2">{rangeLabel(b.start, b.end)}</td>
              <td className="px-2.5 py-2 font-bold">{seat?.seat ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">매주 이 요일·시간에 늘 이 자리예요.</p>
      {review ? (
        <div className="mt-2 rounded-lg border border-late bg-late-soft px-3 py-2 text-sm text-late">
          누적오답은 다 마치면 하원해요. <b>🏠 하원</b>을 누르면 그때부터 오늘 이 자리가 빈자리가 되고, 임시 자리로 쓸 수 있어요.
        </div>
      ) : null}
    </Modal>
  );
}

function AskSeatModal({
  move,
  seat,
  from,
  className,
  onClose,
  onSend,
}: {
  move: Move;
  seat: string;
  from: string | null;
  className: string;
  onClose: () => void;
  onSend: (scope: "TODAY" | "ALWAYS", reason: string) => void;
}) {
  const [scope, setScope] = useState<"TODAY" | "ALWAYS">("TODAY");
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      width={460}
      title="🙋 자리 요청"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSend(scope, reason)}>
            요청 보내기
          </button>
        </>
      }
    >
      <div className="text-lg">
        <b>{move.name}</b> ({className}){" "}
        <b>
          {from ?? "—"} → {seat}
        </b>
      </div>
      <label className="label mt-3">언제까지</label>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={scope === "TODAY"} onChange={() => setScope("TODAY")} /> 오늘만
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={scope === "ALWAYS"} onChange={() => setScope("ALWAYS")} /> 계속
        </label>
      </div>
      <label className="label mt-3">사유 (선택)</label>
      <input className="field" placeholder="예) 시력 · 짝 분리 · 집중" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function AdhocForm({ snap, initialDay, onClose, onNext }: { snap: SrSnapshot; initialDay: number; onClose: () => void; onNext: (d: AdhocDraft) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("보강");
  const [day, setDay] = useState(initialDay);
  const [start, setStart] = useState<number | null>(17 * 60 + 10);
  const [end, setEnd] = useState<number | null>(18 * 60);
  const [error, setError] = useState<string | null>(null);
  const names = [...new Set(snap.classes.flatMap((c) => c.members.map((m) => m.name)))].sort((a, b) => a.localeCompare(b, "ko"));
  const date = weekDateOf(day);
  const next = () => {
    if (!name.trim()) return setError("학생 이름을 입력해 주세요.");
    if (start === null || end === null || start >= end) return setError("끝 시간이 시작보다 늦어야 해요.");
    if (date < weekDateOf(new Date().getDay())) return setError("지난 날이에요. 오늘 이후 요일을 골라 주세요.");
    onNext({ name: name.trim(), kind, date, day, start, end });
  };
  return (
    <Modal
      open
      width={560}
      title="＋ 임시 자리 잡기"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={next}>
            빈 자리 보기
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        정규 SR 말고 보강·자습·TEST로 SR을 쓸 때 <b>그날 하루만</b> 자리를 잡아요. 지난 날짜는 저절로 안 보여요.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div>
          <label className="label">학생 이름</label>
          <input className="field" list="adhoc-names" placeholder="예) 김서준" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="adhoc-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label">종류</label>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            {["보강", "자습", "TEST", "신규TEST"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">요일 (이번 주)</label>
          <select className="field" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {WEEK.map((x) => (
              <option key={x} value={x}>
                {DAY_LABELS[x]}요일 ({monthDay(weekDateOf(x))})
              </option>
            ))}
          </select>
        </div>
        <div />
        <div>
          <label className="label">시작</label>
          <TimeSelect value={start} onChange={setStart} />
        </div>
        <div>
          <label className="label">끝</label>
          <TimeSelect value={end} onChange={setEnd} />
        </div>
      </div>
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}
