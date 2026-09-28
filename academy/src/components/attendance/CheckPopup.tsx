"use client";

// ① 1차 출석체크 — 같은 시각에 시작한 반들을 반별로 모아 "왔음" 체크.
// 알파가 먼저 시작하면 데스크, 수업이 먼저면 담당 선생님이 받는다.
// 미리 결석 연락이 온 학생은 "결석 연락" + 사유 → 전화 단계 없이 바로 결석.

import { useState } from "react";
import PopupFrame, { WhoBadge } from "./PopupFrame";
import ReasonChips from "./ReasonChips";
import { useAlarmLoop } from "../useAlarmLoop";
import { apiPost, errorMessage } from "@/lib/http";
import { fmtTime, rangeLabel } from "@/lib/time";
import { hasRole, type AbsenceCat, type AttendanceGroup, type SessionUser } from "@/lib/types";

type Draft = { present: boolean; pre: boolean; reason: string; cat: AbsenceCat | null };
const keyOf = (eventId: number, studentId: number) => `${eventId}-${studentId}`;

export default function CheckPopup({
  group,
  user,
  muted,
  onToggleMute,
  onDone,
}: {
  group: AttendanceGroup;
  user: SessionUser;
  muted: boolean;
  onToggleMute: () => void;
  onDone: () => void;
}) {
  // 미리 등록된 결석은 「결석 연락」 + 사유가 채워진 채로 시작한다
  const [draft, setDraft] = useState<Record<string, Draft>>(() => {
    const init: Record<string, Draft> = {};
    for (const e of group.events)
      for (const r of e.records)
        if (r.preNotified) init[keyOf(e.id, r.studentId)] = { present: false, pre: true, reason: r.absentReason ?? "", cat: r.absentCat };
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useAlarmLoop(true, muted);

  const EMPTY: Draft = { present: false, pre: false, reason: "", cat: null };
  const get = (k: string): Draft => draft[k] ?? EMPTY;
  /** 항상 최신 상태를 기준으로 바꾼다 — 빠르게 연달아 눌러도 클릭이 사라지지 않게 */
  const set = (k: string, change: (cur: Draft) => Partial<Draft>) =>
    setDraft((d) => {
      const cur = d[k] ?? EMPTY;
      return { ...d, [k]: { ...cur, ...change(cur) } };
    });

  const all = group.events.flatMap((e) => e.records.map((r) => ({ e, r, k: keyOf(e.id, r.studentId) })));
  const waiting = all.filter(({ k }) => !get(k).present && !get(k).pre).length;
  const noReason = all.filter(({ k }) => get(k).pre && !get(k).reason.trim()).length;
  const isDesk = group.events[0]?.checker === "DESK";

  const allPresent = (eventId: number) =>
    setDraft((d) => {
      const next = { ...d };
      const ev = group.events.find((e) => e.id === eventId);
      for (const r of ev?.records ?? []) {
        const k = keyOf(eventId, r.studentId);
        if (!next[k]?.pre) next[k] = { present: true, pre: false, reason: "", cat: null };
      }
      return next;
    });

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/attendance/submit", {
        step: "CHECK",
        items: group.events.map((e) => ({
          eventId: e.id,
          records: e.records.map((r) => {
            const d = get(keyOf(e.id, r.studentId));
            return { studentId: r.studentId, present: d.present, preNotified: d.pre, absentReason: d.reason, absentCat: d.cat };
          }),
        })),
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const total = all.length;
  return (
    <PopupFrame
      heading="출석체크해주세요."
      subtitle={
        <>
          <WhoBadge>{isDesk && hasRole(user, "DESK") ? "데스크" : `${user.name} 선생님`}</WhoBadge>
          {fmtTime(group.triggerMin)} {isDesk ? "알파" : "수업"} 시작 · {group.events.length}개 반 · {total}명
        </>
      }
      muted={muted}
      onToggleMute={onToggleMute}
      error={error}
      note={
        <>
          체크하지 않은 <b>{waiting}명</b>은 제출하면 <b>출결전화</b>로 넘어가고, 결석 연락 받은 학생은 바로 결석
          처리됩니다.
        </>
      }
      footer={
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={busy || noReason > 0}
        >
          {busy ? "제출 중…" : noReason > 0 ? `결석 사유 ${noReason}명 입력 필요` : "제출 완료"}
        </button>
      }
    >
      <div className="space-y-3">
        {group.events.map((e) => {
          const came = e.records.filter((r) => get(keyOf(e.id, r.studentId)).present).length;
          const alpha =
            e.alphaStartMin !== null && e.alphaEndMin !== null ? rangeLabel(e.alphaStartMin, e.alphaEndMin) : null;
          return (
            <section key={e.id} className="overflow-hidden rounded-xl border border-line">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-navy-50 px-4 py-2.5">
                <div className="min-w-0">
                  <span className="text-base font-bold text-ink">{e.className}</span>
                  <span className="ml-2 text-xs text-muted">
                    {e.teacherName ? `${e.teacherName} 선생님 · ` : ""}
                    {isDesk && alpha ? `알파 ${alpha}` : `수업 ${rangeLabel(e.startMin, e.endMin)}`} · 출석 {came}/
                    {e.records.length}명
                  </span>
                </div>
                <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => allPresent(e.id)}>
                  전원 출석
                </button>
              </div>
              {e.records.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">이 반에 등록된 학생이 없습니다.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 p-3">
                  {e.records.map((r) => {
                    const k = keyOf(e.id, r.studentId);
                    const d = get(k);
                    return (
                      <div
                        key={k}
                        className={`rounded-lg border px-3 py-2 ${
                          d.present
                            ? "border-present bg-present-soft"
                            : d.pre
                              ? "border-alert bg-alert-soft"
                              : "border-line bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <label className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2.5">
                            <input
                              type="checkbox"
                              className="h-5 w-5 shrink-0 cursor-pointer accent-present"
                              checked={d.present}
                              disabled={d.pre}
                              onChange={() => set(k, (c) => ({ present: !c.present }))}
                              aria-label={`${r.studentName} 왔음`}
                            />
                            <span className="truncate font-semibold text-ink">{r.studentName}</span>
                            {d.present ? <span className="text-xs font-bold text-present">왔음</span> : null}
                          </label>
                          {!d.present ? (
                            <button
                              type="button"
                              className={`btn shrink-0 px-2 py-0.5 text-xs ${
                                d.pre ? "border-alert bg-alert text-white hover:bg-alert" : ""
                              }`}
                              onClick={() => set(k, (c) => ({ pre: !c.pre, reason: "", cat: null }))}
                              title="학부모에게 미리 결석 연락을 받았어요 (다시 누르면 취소)"
                            >
                              {d.pre ? "결석 연락 ✓" : "결석 연락"}
                            </button>
                          ) : null}
                        </div>
                        {d.pre ? (
                          <>
                            <input
                              className={`field mt-2 ${d.reason.trim() ? "" : "border-late"}`}
                              placeholder="결석 사유 (필수) — 아래에서 고르거나 직접 입력"
                              value={d.reason}
                              onChange={(ev) => {
                                const reason = ev.target.value;
                                set(k, () => ({ reason, cat: null }));
                              }}
                              autoFocus={!d.reason}
                            />
                            <ReasonChips size="xs" value={d.reason} onPick={(reason, cat) => set(k, () => ({ reason, cat }))} />
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </PopupFrame>
  );
}
