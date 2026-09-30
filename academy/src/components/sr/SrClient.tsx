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
import PrintSheet, { type PrintKind } from "./PrintSheet";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { can, dayLimit } from "@/lib/perm";
import { playAlarm } from "@/lib/alarm";
import { classColorMap, LEVEL_COLOR, type ClassColor } from "@/lib/colors";
import { LEVEL_NAME, classMoveOptions, freeSeatsBetween, keyBlocks, movableSeatsFor, occupantsAt, seatBlocker, seatCol, studentSwapCheck, type SeatUse } from "@/lib/sr";
import { DAY_LABELS, addDaysKey, clockLabel, dateKey, fmtTime, minutesOfDay, monthDay, rangeLabel, weekDateOf } from "@/lib/time";
import { teacherLabel, type SessionUser } from "@/lib/types";
import type { SrAdhocRequest, SrClass, SrSnapshot } from "@/lib/repo/sr";
import AdhocRequestPopup from "./AdhocRequestPopup";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** 그 요일에 오는 학생 — 숙제반은 요일마다 다르다 */
const membersOn = (c: SrClass, day: number) => c.members.filter((m) => !m.days || m.days.includes(day));
type Move = { classId: number; studentId: number; name: string };
type AdhocDraft = { name: string; kind: string; date: string; day: number; start: number; end: number };

export default function SrClient({ user }: { user: SessionUser }) {
  const confirm = useConfirm();
  const desk = can(user, "sr.desk");
  const mover = can(user, "sr.move");
  const requester = !mover && can(user, "sr.request");

  const [view, setView] = useState<"live" | "day" | "next">("live");
  const [live, setLive] = useState<SrSnapshot | null>(null);
  const [daySnap, setDaySnap] = useState<SrSnapshot | null>(null);
  // 알바 데스크는 근무 요일만
  const limit = dayLimit(user);
  const [day, setDay] = useState(() => (limit && !limit.includes(new Date().getDay()) ? (limit[0] ?? new Date().getDay()) : new Date().getDay()));
  const [slot, setSlot] = useState(0);
  const [now, setNow] = useState(() => minutesOfDay(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [adhoc, setAdhoc] = useState<AdhocDraft | null>(null);
  const [student, setStudent] = useState<Move | null>(null);
  const [ask, setAsk] = useState<{ seat: string } | null>(null);
  const [adhocForm, setAdhocForm] = useState(false);
  /** 🙋 SR 자리 요청 — 선생님 요청 창 / 데스크 배정 창 */
  const [adhocAsk, setAdhocAsk] = useState(false);
  const [adhocAnswer, setAdhocAnswer] = useState<SrAdhocRequest | null>(null);
  /** 🗑 요청 기록 지우기 (관리자) */
  const [purge, setPurge] = useState(false);
  /** 📅 다음 달 자리 미리보기 */
  const [nextSnap, setNextSnap] = useState<SrSnapshot | null>(null);
  /** ↔ 반 통째로 옮기기 — 옮기는 반 */
  const [classMove, setClassMove] = useState<number | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [printPick, setPrintPick] = useState(false);
  const [printJob, setPrintJob] = useState<{ kind: PrintKind; snap: SrSnapshot } | null>(null);
  const nextMonth = (new Date().getMonth() + 1) % 12 + 1;
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
  const loadNext = useCallback(async () => {
    try {
      setNextSnap(await apiGet<SrSnapshot>(`/api/sr?date=${dayDate}&preview=1`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [dayDate]);
  const reload = useCallback(async () => {
    await Promise.all([loadLive(), view === "day" ? loadDay() : view === "next" ? loadNext() : Promise.resolve()]);
  }, [loadLive, loadDay, loadNext, view]);

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
    if (view === "next") void loadNext();
  }, [view, loadDay, loadNext]);
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

  const snapFor = view === "live" ? live : view === "day" ? daySnap : nextSnap;
  const cls = (snap: SrSnapshot | null, id: number) => snap?.classes.find((c) => c.id === id);
  const nameOf = (snap: SrSnapshot, classId: number, studentId: number) => cls(snap, classId)?.members.find((m) => m.id === studentId)?.name ?? "";


  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["live", "실시간 좌석 현황"],
              ["day", "요일별 자리 배치"],
              ["next", `📅 ${nextMonth}월 자리 미리보기`],
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
                setClassMove(null);
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {requester ? (
            <button type="button" className="btn border-srpink bg-srpink text-white hover:bg-srpink" onClick={() => setAdhocAsk(true)} disabled={!live}>
              🙋 SR 자리 요청
            </button>
          ) : null}
          {desk ? (
            <button type="button" className="btn" onClick={() => setAdhocForm(true)}>
              ＋ 임시 자리 잡기
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => setPrintPick(true)} disabled={!live}>
            <IconPrinter className="h-4 w-4" />
            좌석표 인쇄 (PDF)
          </button>
          {can(user, "sr.pack") ? (
            <button type="button" className="btn" onClick={() => setPackOpen(true)}>
              🧹 자리 정리
            </button>
          ) : null}
          {can(user, "sr.purge") ? (
            <button type="button" className="btn" onClick={() => setPurge(true)}>
              🗑 요청 기록 지우기
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

      {live ? <AdhocRequestPanel user={user} snap={live} act={act} onAnswer={setAdhocAnswer} /> : null}
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
          adhoc={view === "next" ? null : adhoc}
          preview={view === "next"}
          onConfirmNext={
            can(user, "sr.pack")
              ? async (undo) => {
                  const m = nextMonth;
                  const yes = await confirm(
                    undo
                      ? { title: `${m}월 자리 확정을 풀까요?`, message: `직접 옮긴 자리도 없어지고, ${m}/1에 그날 명단으로 새로 계산해요.`, confirmText: "확정 풀기" }
                      : {
                          title: `📌 ${m}월 자리를 확정할까요?`,
                          message: `지금 보이는 자리 그대로 ${m}/1에 바뀌어요. 그 사이 새로 온 학생만 빈자리에 앉고, 빠진 학생 자리는 비워요. 확정한 뒤 인쇄하세요.`,
                          confirmText: "확정",
                        },
                  );
                  if (yes) void act({ action: "CONFIRM_NEXT", undo }, undo ? "확정 풀었어요" : `📌 ${m}월 자리 확정`);
                }
              : undefined
          }
          classMove={classMove}
          onClassMove={(id) => {
            setMove(null);
            setAdhoc(null);
            setClassMove(id);
          }}
          onPickClassCol={async (col) => {
            if (classMove === null || !snapFor) return;
            const c = snapFor.classes.find((x) => x.id === classMove);
            const opt = classMoveOptions(snapFor.weekUses, (id) => snapFor.blocks.filter((b) => b.classId === id), classMove).get(col);
            if (!opt || (opt.kind !== "move" && opt.kind !== "swap")) return;
            const next = view === "next";
            const where = next ? ` (${nextMonth}월 자리 · 📌 확정돼요)` : "";
            const yes = await confirm({
              title: opt.kind === "swap" ? `${c?.name} ⇄ ${opt.label} 자리를 맞바꿀까요?` : `${c?.name}을(를) ${col}열로 옮길까요?`,
              message:
                opt.kind === "swap"
                  ? `${c?.name} → ${col}열 · ${opt.label} → ${c?.name}이(가) 앉던 열. 두 반이 SR을 쓰는 모든 요일에 적용돼요.${where}`
                  : `${c?.name} ${c?.members.length ?? 0}명 → ${col}1부터. 이 반이 SR을 쓰는 모든 요일에 적용돼요.${where}`,
              confirmText: opt.kind === "swap" ? "맞바꾸기" : "옮기기",
            });
            if (yes && (await act({ action: next ? "NEXT_MOVE_CLASS" : "MOVE_CLASS", classId: classMove, col }, opt.kind === "swap" ? "맞바꿈" : `${col}열로 옮김`))) setClassMove(null);
          }}
          cancelMode={() => {
            setMove(null);
            setAdhoc(null);
            setClassMove(null);
          }}
          onPickMove={(seat) => {
            if (!move) return;
            if (view === "next") void act({ action: "NEXT_MOVE", classId: move.classId, studentId: move.studentId, seat }, `${move.name} → ${seat}`).then((ok) => ok && setMove(null));
            else if (mover)
              void act({ action: "MOVE", classId: move.classId, studentId: move.studentId, seat }, `${move.name} → ${seat} (모든 요일 같은 자리로)`).then((ok) => ok && setMove(null));
            else setAsk({ seat });
          }}
          onPickAdhoc={(seat) => {
            if (!adhoc) return;
            void act({ action: "ADHOC", ...adhoc, seat }, `${adhoc.name} → ${seat} (${adhoc.kind})`).then((ok) => ok && setAdhoc(null));
          }}
          onStudent={(o) => {
            if (!o.classId || !o.studentId) return;
            // 📅 미리보기는 누르면 바로 옮기기 (데스크·관리자)
            if (view !== "next") setStudent({ classId: o.classId, studentId: o.studentId, name: o.name });
            else if (mover) {
              setClassMove(null);
              setMove({ classId: o.classId, studentId: o.studentId, name: o.name });
            }
          }}
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

      {printPick && live ? (
        <PrintPickModal
          nextMonth={nextMonth}
          onClose={() => setPrintPick(false)}
          onPick={async (kind, date) => {
            const snap = kind === "week" ? live : await apiGet<SrSnapshot>(kind === "next" ? "/api/sr?preview=1" : `/api/sr?date=${date}`);
            setPrintPick(false);
            setPrintJob({ kind, snap });
          }}
        />
      ) : null}
      {printJob ? <PrintSheet snap={printJob.snap} kind={printJob.kind} onClose={() => setPrintJob(null)} /> : null}

      {packOpen ? (
        <PackModal
          onClose={() => setPackOpen(false)}
          onPack={async (mode) => {
            if (await act({ action: "PACK", mode }, mode === "RESET" ? "처음부터 다시 앉혔어요" : "빈자리를 앞으로 당겨 정리했어요")) setPackOpen(false);
          }}
        />
      ) : null}

      {adhocAsk && live ? (
        <AdhocAskModal
          user={user}
          snap={live}
          onClose={() => setAdhocAsk(false)}
          onSend={async (body) => {
            if (await act({ action: "ADHOC_REQUEST", ...body }, "요청 보냄 — 데스크가 자리를 정하면 알림함으로 와요")) setAdhocAsk(false);
          }}
        />
      ) : null}

      {adhocAnswer ? (
        <AdhocRequestPopup
          request={adhocAnswer}
          alarm={false}
          onClose={() => setAdhocAnswer(null)}
          onDone={() => {
            setAdhocAnswer(null);
            void reload();
          }}
        />
      ) : null}

      {purge && live ? (
        <PurgeModal
          list={live.adhocRecent}
          onClose={() => setPurge(false)}
          onPurge={async (r) => {
            if (!(await confirm({ title: "요청 기록을 지울까요?", message: <PurgeWhat r={r} />, confirmText: "지우기", danger: true }))) return null;
            try {
              await apiPost("/api/sr/action", { action: "ADHOC_PURGE", id: r.id });
              await reload();
              setToast("지움");
              return null;
            } catch (e) {
              return errorMessage(e);
            }
          }}
        />
      ) : null}

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

/** 🙋 SR 자리 요청 (임시 자리) — 데스크·관리자: 대기 중 → 「자리 정하기」 / 선생님: 내가 오늘 보낸 요청 */
function AdhocRequestPanel({
  user,
  snap,
  act,
  onAnswer,
}: {
  user: SessionUser;
  snap: SrSnapshot;
  act: (b: Record<string, unknown>, ok?: string) => Promise<boolean>;
  onAnswer: (r: SrAdhocRequest) => void;
}) {
  const desk = can(user, "sr.desk");
  const now = snap.nowMin;
  const list = desk
    ? snap.adhocRequests.filter((r) => r.state === "WAIT" && r.end > now).reverse()
    : snap.adhocRequests.filter((r) => r.requestedBy === user.id && r.state !== "CANCEL");
  if (!list.length) return null;
  const ST = { WAIT: "⏳ 대기", NO: "❌ 거절", CANCEL: "취소함" } as const;
  return (
    <div className="rounded-xl border border-srpink-soft bg-srpink-soft px-4 py-2.5 text-sm text-srpink">
      <b>{desk ? `🙋 SR 자리 요청 ${list.length}건` : "🙋 내 SR 자리 요청 (오늘)"}</b>
      {list.map((r) => (
        <div key={r.id} className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-ink">
          <span>
            {desk ? <b>{teacherLabel(r.requestedByName)} · </b> : null}
            <b>{r.name}</b> {r.kind} · {rangeLabel(r.start, r.end)}
            {r.memo ? ` · ${r.memo}` : ""} <span className="text-muted">{clockLabel(r.atMin)}</span>
          </span>
          {desk ? (
            <button type="button" className="btn btn-primary whitespace-nowrap px-2.5 py-0.5 text-xs" onClick={() => onAnswer(r)}>
              자리 정하기
            </button>
          ) : r.state === "WAIT" ? (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <b>{ST.WAIT}</b>
              <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => void act({ action: "ADHOC_CANCEL", id: r.id }, "요청 취소")}>
                요청 취소
              </button>
            </span>
          ) : (
            <b className="whitespace-nowrap">{r.state === "OK" ? `✅ ${r.seat} 배정` : ST[r.state]}</b>
          )}
        </div>
      ))}
    </div>
  );
}

/** 🗑 요청 기록 지우기 (관리자) — 테스트 요청을 흔적 없이. 요청 · 임시 자리 · 📝 기록 · 선생님 알림 */
const PURGE_ST = { WAIT: "⏳ 대기", NO: "❌ 거절", CANCEL: "취소" } as const;

function PurgeWhat({ r }: { r: SrAdhocRequest }) {
  return (
    <>
      <b>{r.name}</b> {r.kind} · {monthDay(r.date)} {rangeLabel(r.start, r.end)}
      <br />
      <span className="text-muted">요청 · 임시 자리 · 📝 기록 · 알림이 함께 지워져요. 되돌릴 수 없어요.</span>
    </>
  );
}

function PurgeModal({ list, onClose, onPurge }: { list: SrAdhocRequest[]; onClose: () => void; onPurge: (r: SrAdhocRequest) => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open width={620} title="🗑 요청 기록 지우기" subtitle="🙋 SR 자리 요청 · 최근 7일 · 테스트 기록 정리용" onClose={onClose}>
      {list.length === 0 ? <p className="text-sm text-muted">최근 7일 요청이 없어요.</p> : null}
      {list.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-b-0">
          <span>
            <span className="text-muted">{monthDay(r.date)}</span> <b>{teacherLabel(r.requestedByName)}</b> · <b>{r.name}</b> {r.kind} · {rangeLabel(r.start, r.end)}{" "}
            <span className="text-muted">{r.state === "OK" ? `✅ ${r.seat} 배정` : PURGE_ST[r.state]}</span>
          </span>
          <button
            type="button"
            className="btn whitespace-nowrap px-2.5 py-0.5 text-xs text-alert"
            onClick={async () => {
              setError(null);
              setError(await onPurge(r));
            }}
          >
            지우기
          </button>
        </div>
      ))}
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

/** 🖨 좌석표 인쇄 — 한 주 / 하루(보강·임시 자리·하원 반영) / 다음 달 미리보기 */
function PrintPickModal({ nextMonth, onClose, onPick }: { nextMonth: number; onClose: () => void; onPick: (kind: PrintKind, date: string) => Promise<void> }) {
  const [kind, setKind] = useState<PrintKind>("week");
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(dateKey(new Date()), i));
  const [date, setDate] = useState(days[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opt = (k: PrintKind, label: string, sub: string) => (
    <button type="button" className={`rounded-xl border px-3 py-2.5 text-left text-sm ${kind === k ? "border-2 border-navy-800" : "border-line"}`} onClick={() => setKind(k)}>
      <b>{label}</b>
      <span className="block text-xs text-muted">{sub}</span>
    </button>
  );
  return (
    <Modal
      open
      width={560}
      title="🖨 좌석표 인쇄"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await onPick(kind, date);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            미리보기
          </button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {opt("week", "한 주", "월수금 / 화목토 2장")}
        {opt("day", "하루", "📌 보강 · 임시 자리 · 🏠 하원까지")}
        {opt("next", `📅 ${nextMonth}월`, "다음 달 자리 미리보기")}
      </div>
      {kind === "day" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {days.map((d, i) => (
            <button key={d} type="button" className={`btn px-2.5 py-1 text-xs ${date === d ? "btn-primary" : ""}`} onClick={() => setDate(d)}>
              {i === 0 ? "오늘 " : i === 1 ? "내일 " : ""}
              {monthDay(d)}({DAY_LABELS[new Date(`${d}T00:00:00`).getDay()]})
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

/** 🧹 자리 정리 (관리자) — 앞으로 당기기 / 처음부터 다시 앉히기. 누르기 전에 바뀌는 학생을 보여 준다 */
function PackModal({ onClose, onPack }: { onClose: () => void; onPack: (mode: "PACK" | "RESET") => Promise<void> }) {
  const [mode, setMode] = useState<"PACK" | "RESET">("PACK");
  const [diff, setDiff] = useState<{ name: string; className: string; from: string | null; to: string | null }[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setDiff(null);
    setError(null);
    apiGet<typeof diff>(`/api/sr/pack-diff?mode=${mode}`)
      .then((d) => alive && setDiff(d))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [mode]);
  const opt = (m: "PACK" | "RESET", label: string, sub: string) => (
    <button type="button" className={`mb-2 block w-full rounded-xl border px-3 py-2.5 text-left text-sm ${mode === m ? "border-2 border-navy-800" : "border-line"}`} onClick={() => setMode(m)}>
      <b>{label}</b>
      <span className="block text-xs text-muted">{sub}</span>
    </button>
  );
  return (
    <Modal
      open
      width={560}
      title="🧹 자리 정리"
      subtitle="매달 1일에는 저절로 「처음부터 다시 앉히기」를 해요"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={!diff} onClick={() => void onPack(mode)}>
            정리하기
          </button>
        </>
      }
    >
      {opt("PACK", "앞으로 당기기", "반마다 쓰던 열은 그대로 · 빈자리만 앞으로 · 사람이 옮긴 자리 그대로")}
      {opt("RESET", "처음부터 다시 앉히기", "지금 명단 · 지금 규칙으로 열까지 새로 · 사람이 옮긴 자리도 초기화")}
      <div className="mt-1 rounded-xl border border-late bg-late-soft px-3 py-2 text-sm">
        {error ? (
          <span className="font-semibold text-alert">{error}</span>
        ) : !diff ? (
          <span className="text-muted">계산 중…</span>
        ) : diff.length === 0 ? (
          <span>바뀌는 학생 없음</span>
        ) : (
          <>
            바뀌는 학생 <b>{diff.length}명</b>{" "}
            <button type="button" className="font-semibold text-navy-700 underline" onClick={() => setOpen(!open)}>
              {open ? "접기" : "누가 바뀌는지 보기"}
            </button>
            {open ? (
              <div className="mt-2 max-h-56 overflow-auto rounded-lg bg-white px-2 py-1 text-xs">
                {diff.map((d, i) => (
                  <div key={i} className="border-b border-line py-1 last:border-b-0">
                    {d.className} <b>{d.name}</b> {d.from ?? "—"} → {d.to ?? <span className="text-alert">자리 없음</span>}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

/** 🙋 SR 자리 요청 창 (선생님) — 학생 · 종류 · 시간만 보낸다. 오늘만. 자리는 데스크가 정한다 */
function AdhocAskModal({
  user,
  snap,
  onClose,
  onSend,
}: {
  user: SessionUser;
  snap: SrSnapshot;
  onClose: () => void;
  onSend: (b: { name: string; kind: string; start: number; end: number; memo: string }) => void;
}) {
  const nowRound = Math.ceil(minutesOfDay(new Date()) / 10) * 10;
  const [name, setName] = useState("");
  const [kind, setKind] = useState("보강");
  const [start, setStart] = useState<number | null>(Math.min(nowRound, 23 * 60 - 60));
  const [end, setEnd] = useState<number | null>(Math.min(nowRound + 60, 23 * 60 + 50));
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 이름 목록 — 내 반 학생 먼저
  const byName = (list: SrClass[]) => [...new Set(list.flatMap((c) => c.members.map((m) => m.name)))].sort((a, b) => a.localeCompare(b, "ko"));
  const names = [...new Set([...byName(snap.classes.filter((c) => c.teacherId === user.id)), ...byName(snap.classes)])];
  const ok = start !== null && end !== null && end > start;
  const free = ok ? freeSeatsBetween(snap.dayUses, snap.day, start, end).length : null;
  const send = () => {
    if (!name.trim()) return setError("학생 이름을 입력해 주세요.");
    if (!ok) return setError("끝 시간이 시작보다 늦어야 해요.");
    if (end! <= minutesOfDay(new Date())) return setError("이미 지난 시간이에요.");
    onSend({ name: name.trim(), kind, start: start!, end: end!, memo });
  };
  return (
    <Modal
      open
      width={560}
      title="🙋 SR 자리 요청"
      subtitle={`오늘 ${monthDay(snap.date)}(${DAY_LABELS[snap.day]}) · 데스크가 자리를 정해 줘요`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={send}>
            요청 보내기
          </button>
        </>
      }
    >
      <label className="label">학생</label>
      <input className="field" list="adhoc-ask-names" placeholder="이름 입력" value={name} onChange={(e) => setName(e.target.value)} />
      <datalist id="adhoc-ask-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <p className="mt-1 text-xs text-muted">이름을 치면 목록이 떠요 (내 반 학생 먼저). 명단에 없는 학생도 그대로 보낼 수 있어요.</p>
      <label className="label mt-3">종류</label>
      <div className="flex gap-1.5">
        {["보강", "자습", "TEST", "신규TEST"].map((k) => (
          <button key={k} type="button" className={`btn px-2.5 py-1 text-xs ${kind === k ? "btn-primary" : ""}`} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div>
          <label className="label">시작</label>
          <TimeSelect value={start} onChange={setStart} />
        </div>
        <div>
          <label className="label">끝</label>
          <TimeSelect value={end} onChange={setEnd} />
        </div>
      </div>
      <p className="mt-3 text-sm">
        {free === null ? (
          <span className="text-muted">시간을 골라 주세요</span>
        ) : free === 0 ? (
          <b className="text-alert">이 시간에 빈자리 없음 — 시간을 바꿔 보세요</b>
        ) : (
          <>
            이 시간 내내 빈자리 <b className="text-present">{free}석</b>
          </>
        )}
      </p>
      <label className="label mt-2">메모 (선택)</label>
      <input className="field" placeholder="예) 결석 보강" value={memo} onChange={(e) => setMemo(e.target.value)} />
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
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

/**
 * 📄 미션지 확인 (데스크) — 지금 SR · 30분 안에 들어올 반 중 아직 확인 안 한 반.
 * 약속 장소에 있는 반만 체크하고 「확인 완료」 → 체크한 반 = 받음, 나머지 = 담당T에게 요청 (한 번에)
 */
function MissionCheck({ list, act }: { list: SrClass[]; act: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const [have, setHave] = useState<number[]>([]);
  const toggle = (id: number) => setHave((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  const ids = list.map((c) => c.id);
  const got = have.filter((id) => ids.includes(id));
  const missing = list.filter((c) => !got.includes(c.id));
  const noTeacher = missing.filter((c) => !c.teacherId);
  const submit = async () => {
    const ok = await act(
      { action: "MISSION_CHECK", have: got, missing: missing.filter((c) => c.teacherId).map((c) => c.id) },
      missing.length ? `✅ ${got.length}개 반 받음 · 📣 ${missing.length - noTeacher.length}개 반 요청` : `✅ ${got.length}개 반 받음`,
    );
    if (ok) setHave([]);
  };
  return (
    <div className="rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-alert">📄 미션지 확인</b>
        <span className="text-xs text-muted">있는 반만 체크</span>
        {list.map((c) => {
          const on = got.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={`btn px-2.5 py-1 text-xs ${on ? "border-present bg-present-soft text-present" : ""}`}
              onClick={() => toggle(c.id)}
            >
              {on ? "✅" : "☐"} {c.name} <span className="text-muted">{teacherLabel(c.teacherName)}</span>
            </button>
          );
        })}
        <button type="button" className="btn btn-primary ml-auto px-3 py-1 text-xs" onClick={() => void submit()}>
          확인 완료{missing.length ? ` · 없는 반 ${missing.length - noTeacher.length}개 📣 요청` : ""}
        </button>
      </div>
      {noTeacher.length ? (
        <p className="mt-1 text-xs font-semibold text-alert">담당T가 없어 요청 못 함: {noTeacher.map((c) => c.name).join(", ")}</p>
      ) : null}
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
          {rangeLabel(b.start, b.end)} · {membersOn(c, b.day).length}명
          {(() => {
            const n = snap.absent.filter((a) => a.classId === c.id).length;
            return n ? <b className="text-alert"> (결석 {n})</b> : null;
          })()}{" "}
          · {columnsOf(snap, c.id) || "—"}열{review ? " · 다 끝내면 하원" : ""}
        </div>
        <div className="mt-1 text-xs">
          {membersOn(c, b.day).map((m, i) => {
            const gone = snap.leave.find((l) => l.classId === c.id && l.studentId === m.id);
            const absent = snap.absent.find((a) => a.classId === c.id && a.studentId === m.id);
            const seat = snap.dayUses.find((u) => u.key === `${c.id}|${m.id}`)?.seat ?? snap.seats.find((s) => s.classId === c.id && s.studentId === m.id)?.seat;
            return (
              <span key={m.id}>
                {i ? " · " : ""}
                {absent ? (
                  <span className="text-muted" title={absent.reason ? `결석 · ${absent.reason}` : "결석"}>
                    {m.name} <b className="text-alert">결석</b>
                  </span>
                ) : gone && gone.atMin <= now ? (
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
        can(user, "sr.desk") ? (
          <MissionCheck list={missing} act={act} />
        ) : (
          <div className="rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-bold text-alert">
            📄 미션지 없음: <b>{missing.map((c) => c.name).join(", ")}</b>
          </div>
        )
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
            학생을 누르면 자리 정보 · {can(user, "sr.move") ? "자리 바꾸기" : "🙋 자리 요청"} · 10분 안에 끝나는 자리는 「곧 끝」 · 빗금 = 임시 자리 · 결석 = 빈자리
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
  preview,
  classMove,
  onConfirmNext,
  onClassMove,
  onPickClassCol,
}: {
  user: SessionUser;
  snap: SrSnapshot;
  /** 📅 다음 달 자리 미리보기 — 데스크·관리자는 옮기면 그대로 📌 확정 */
  preview?: boolean;
  classMove: number | null;
  /** 📌 다음 달 자리 확정 (관리자) — undo = 확정 풀기 */
  onConfirmNext?: (undo: boolean) => void;
  onClassMove: (classId: number) => void;
  onPickClassCol: (col: string) => void;
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

  let mark: ((seat: string, o?: SeatUse) => SeatMark | null) | undefined;
  let banner = null;
  if (move) {
    const key = `${move.classId}|${move.studentId}`;
    const mine = snap.seats.find((x) => x.classId === move.classId && x.studentId === move.studentId)?.seat;
    const blocks = snap.blocks.filter((b) => b.classId === move.classId);
    const movable = movableSeatsFor(snap.weekUses, keyBlocks(snap.weekUses, key, blocks), key);
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
      const swap = who && preview ? studentSwapCheck(snap.weekUses, (id) => snap.blocks.filter((b) => b.classId === id), key, seat) : null;
      if (swap?.ok)
        return {
          tone: "swap",
          onClick: () => onPickMove(seat),
          title: `${move.name} ⇄ ${swap.other.name}(${swap.other.label})`,
          content: (
            <>
              <span className="mt-1.5 block text-xs font-extrabold">⇄ 맞바꾸기</span>
              <span className="text-[11px]">{swap.other.name}</span>
            </>
          ),
        };
      return who
        ? { tone: "block", title: `쓰는 사람: ${who.name} (${who.label} ${DAY_LABELS[who.day]} ${rangeLabel(who.start, who.end)})`, content: (
              <>
                <span className="mt-1.5 block text-[11px] font-bold">{who.name}</span>
                <span className="block truncate text-[10px]">{who.label} {DAY_LABELS[who.day]} {fmtTime(who.start)}</span>
              </>
            ),
          }
        : { tone: "pick", onClick: () => onPickMove(seat), content: <span className="mt-1.5 block text-sm font-extrabold">여기로</span> };
    };
    banner = (
      <div className="flex items-center justify-between rounded-xl border border-srpink-soft bg-srpink-soft px-4 py-2.5 text-sm font-bold text-srpink">
        <span>
          ↔ <b>{move.name}</b>({snap.classes.find((c) => c.id === move.classId)?.name}) {preview ? `${Number(snap.preview?.month.slice(5))}월 자리 바꾸기` : can(user, "sr.move") ? "자리 바꾸기" : "자리 요청 — 고른 자리를 데스크에 요청해요"} · 이 반이 SR을 쓰는{" "}
          <b>모든 요일·시간</b> 동안 비어 있는 자리만 분홍색이에요.
          {preview ? <span className="text-late"> 노랑 = 그 학생과 맞바꾸기</span> : null}
        </span>
        <span className="flex shrink-0 gap-1.5">
          {can(user, "sr.move") ? (
            <button type="button" className="btn border-srpink px-2.5 py-1 text-xs text-srpink" onClick={() => onClassMove(move.classId)}>
              ↔ {snap.classes.find((c) => c.id === move.classId)?.name} 반 전체 옮기기
            </button>
          ) : null}
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={cancelMode}>
            취소
          </button>
        </span>
      </div>
    );
  } else if (classMove !== null) {
    const opts = classMoveOptions(snap.weekUses, (id) => snap.blocks.filter((b) => b.classId === id), classMove);
    const cname = snap.classes.find((c) => c.id === classMove)?.name ?? "";
    mark = (seat, o) => {
      const col = seatCol(seat);
      const opt = opts.get(col);
      const who = <span className="mt-1.5 block text-[11px]">{o ? `${o.name} · ${o.label}` : "빈자리"}</span>;
      if (!opt || opt.kind === "self") return { tone: "self", content: <span className="mt-1.5 block text-xs font-extrabold">{o?.name ?? "지금 열"}</span> };
      if (opt.kind === "move")
        return { tone: "pick", onClick: () => onPickClassCol(col), title: `${cname} → ${col}열`, content: <span className="mt-1.5 block text-sm font-extrabold">여기로</span> };
      if (opt.kind === "swap")
        return {
          tone: "swap",
          onClick: () => onPickClassCol(col),
          title: `${cname} ⇄ ${opt.label}`,
          content: (
            <>
              <span className="mt-1.5 block text-xs font-extrabold">⇄ 맞바꾸기</span>
              <span className="text-[11px]">{o?.name ?? ""}</span>
            </>
          ),
        };
      return { tone: "block", title: opt.reason, content: who };
    };
    banner = (
      <div className="flex items-center justify-between rounded-xl border border-srpink-soft bg-srpink-soft px-4 py-2.5 text-sm font-bold text-srpink">
        <span>
          ↔ <b>{cname}</b> 반 통째로 옮기기 — 옮길 열을 누르세요 · 분홍 = 빈 열로 옮기기 · <span className="text-late">노랑 = 그 반과 맞바꾸기</span> · 회색 = 안 됨(마우스를 올리면
          이유). 이 반이 SR을 쓰는 <b>모든 요일</b>에 적용돼요.
        </span>
        <button type="button" className="btn px-2.5 py-1 text-xs" onClick={cancelMode}>
          그만
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
      {preview && snap.preview ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-srpink-soft bg-srpink-soft px-4 py-2.5 text-sm text-srpink">
          {snap.preview.confirmed ? (
            <span>
              <b>📌 {Number(snap.preview.month.slice(5))}월 자리 확정됨</b> ({snap.preview.confirmed.by} · {snap.preview.confirmed.at}) — {Number(snap.preview.month.slice(5))}/1에{" "}
              <b>이 자리 그대로</b> 바뀌어요. 그 사이 새로 온 학생만 빈자리에. 지금과 달라지는 학생 <b>{snap.preview.changed}명</b>
              {can(user, "sr.move") ? <span className="mt-0.5 block font-bold">학생을 누르면 옮기기 · 오른쪽 ↔ = 반 통째로 · 옮기면 바로 📌 확정</span> : null}
            </span>
          ) : (
            <span>
              <b>📅 {Number(snap.preview.month.slice(5))}월 자리 미리보기</b> — 지금 명단(다음 달 숙제반 신청 포함) · 새 규칙으로 처음부터 앉혀 본 모습이에요. 아직 확정 전 · 명단이 바뀌면
              달라져요. 지금과 달라지는 학생 <b>{snap.preview.changed}명</b>
              {can(user, "sr.move") ? <span className="mt-0.5 block font-bold">학생을 누르면 옮기기 · 오른쪽 ↔ = 반 통째로 · 옮기면 바로 📌 확정</span> : null}
            </span>
          )}
          {onConfirmNext ? (
            <span className="flex shrink-0 gap-1.5">
              {snap.preview.confirmed ? (
                <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => onConfirmNext(true)}>
                  확정 풀기
                </button>
              ) : null}
              <button type="button" className="btn btn-primary px-2.5 py-1 text-xs" onClick={() => onConfirmNext(false)}>
                📌 {snap.preview.confirmed ? "다시 확정" : `${Number(snap.preview.month.slice(5))}월 자리 확정`}
              </button>
            </span>
          ) : null}
        </div>
      ) : monthEnd ? (
        <div className="rounded-xl border border-late bg-late-soft px-4 py-2.5 text-sm font-bold text-late">📅 다음 달 1일에 자리를 처음부터 다시 정리해요 — 「📅 다음 달 자리 미리보기」에서 미리 볼 수 있어요.</div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {WEEK.map((x) => (
          <button
            key={x}
            type="button"
            disabled={!!dayLimit(user) && !dayLimit(user)!.includes(x)}
            className={`btn px-3 ${day === x ? "btn-primary" : ""} ${dayLimit(user) && !dayLimit(user)!.includes(x) ? "opacity-40" : ""}`}
            onClick={() => setDay(x)}
          >
            {dayLimit(user) && !dayLimit(user)!.includes(x) ? "🔒 " : ""}
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
        <div className="w-[400px] shrink-0 space-y-3">
          <div className="card p-4">
            <h3 className="mb-2 text-[15px] font-bold">이 요일 SR 반</h3>
            {dayClasses.length === 0 ? <p className="text-sm text-muted">없어요.</p> : null}
            {dayClasses.map((id) => (
              <Legend key={id} snap={snap} classId={id} day={day} color={colors.get(id)} onMove={can(user, "sr.move") ? () => onClassMove(id) : undefined} />
            ))}
          </div>
          {preview ? null : <LogPanel snap={snap} />}
          <div className="card p-4">
            <h3 className="mb-2 text-[15px] font-bold">자리 정하는 규칙</h3>
            <p className="mb-1 text-xs text-muted">위가 먼저 · 10/1부터 새 규칙</p>
            <ol className="list-decimal space-y-1 pl-4 text-[13px] leading-relaxed">
              <li>
                <b>고등부</b>(누적오답 포함)는 <b>혼자 쓰는 열</b>, 되도록 옆 열도 비워서
              </li>
              <li>
                <b>고등 ↔ 초등</b>은 먼 열 (고등 D ↔ 초등 A), 중등은 가운데
              </li>
              <li>
                <b>같은 학년 반</b>은 열을 띄워서 (같은 열 · 바로 옆 열 피함)
              </li>
              <li>
                <b>같은 반은 같은 열</b>, 앞자리(1번)부터 · 모든 SR 요일에 같은 자리
              </li>
            </ol>
            <p className="mt-2 text-xs text-muted">매달 1일에 사람이 옮긴 자리까지 초기화하고 처음부터 다시 앉혀요. 달 중간에 새로 온 학생은 빈자리에.</p>
          </div>
        </div>
      </div>
    </>
  );
}

function Legend({ snap, classId, day, color, onMove }: { snap: SrSnapshot; classId: number; day: number; color?: ClassColor; onMove?: () => void }) {
  const c = snap.classes.find((x) => x.id === classId);
  const b = snap.blocks.find((x) => x.classId === classId && x.day === day);
  if (!c || !b) return null;
  const today = snap.day === new Date().getDay() && day === snap.day;
  const m = snap.missions.find((x) => x.classId === classId);
  const mis = !c.needsMission ? null : !today ? <span title="미션지 필요">📄</span> : m?.state === "DONE" ? <span title="미션지 받음">📄✅</span> : <span title="미션지 없음" className="text-alert">📄❌</span>;
  return (
    <div className="flex items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-b-0">
      <span className="h-3.5 w-3.5 shrink-0 rounded border" style={{ background: color?.bg, borderColor: color?.border }} />
      <b className="whitespace-nowrap">{c.name}</b>
      <span className="rounded px-1.5 text-[11px] font-extrabold text-white" style={{ background: LEVEL_COLOR[c.level] }}>
        {LEVEL_NAME[c.level][0]}
      </span>
      <span className="text-xs text-muted">
        {membersOn(c, day).length}명 · {columnsOf(snap, c.id) || "—"}열 · {rangeLabel(b.start, b.end)}
      </span>
      {mis}
      {onMove ? (
        <button type="button" className="btn ml-auto shrink-0 border-srpink px-2 py-0.5 text-xs font-bold text-srpink" onClick={onMove} title="↔ 반 통째로 옮기기 · 맞바꾸기" aria-label="반 옮기기">
          ↔ 반 옮기기
        </button>
      ) : null}
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
