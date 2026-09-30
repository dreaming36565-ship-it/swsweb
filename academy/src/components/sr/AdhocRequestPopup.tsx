"use client";

// 🙋 SR 자리 요청 — 선생님이 학생 · 시간을 보내면 데스크 화면(어느 메뉴든)에 뜬다.
// 그 시간 내내 비는 자리만 분홍색, 앞자리부터 하나를 추천해 둔다 → 「A3 배정」 한 번이면 끝.
// 팝업으로 뜰 때(alarm): 3초 + 처리할 때까지 1분마다 3초 알림음, 「나중에」 없음.
// SR 관리 위쪽 줄에서 열 때는 알림음 없이 닫을 수 있다.

import { useEffect, useState } from "react";
import SeatMap from "./SeatMap";
import { useAlarmLoop } from "../useAlarmLoop";
import { IconVolume } from "../Icons";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { freeSeatsBetween, seatBlocker } from "@/lib/sr";
import { rangeLabel } from "@/lib/time";
import { teacherLabel } from "@/lib/types";
import type { SrAdhocRequest, SrSnapshot } from "@/lib/repo/sr";

export default function AdhocRequestPopup({
  request,
  alarm,
  muted = false,
  onToggleMute,
  onClose,
  onDone,
}: {
  request: SrAdhocRequest;
  /** 셸에서 팝업으로 뜰 때 — 알림음 반복, 닫기 없음 */
  alarm: boolean;
  muted?: boolean;
  onToggleMute?: () => void;
  onClose?: () => void;
  onDone: () => void;
}) {
  const [snap, setSnap] = useState<SrSnapshot | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useAlarmLoop(alarm, muted);

  const load = async () => {
    try {
      const s = await apiGet<SrSnapshot>("/api/sr");
      setSnap(s);
      return s;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  };
  useEffect(() => {
    void load().then((s) => s && setSel(freeSeatsBetween(s.dayUses, s.day, request.start, request.end)[0] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const free = snap ? freeSeatsBetween(snap.dayUses, snap.day, request.start, request.end) : [];
  const answer = async (ok: boolean) => {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/sr/action", { action: "ADHOC_ANSWER", id: request.id, ok, seat: ok ? sel : null });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      // 그 사이 자리가 찼을 수 있으니 자리표를 다시
      const s = await load();
      if (s && sel && !freeSeatsBetween(s.dayUses, s.day, request.start, request.end).includes(sel)) setSel(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/45 p-6 fade-in print:hidden">
      <div className="card pop-in flex max-h-full w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-bold text-navy-900">🙋 SR 자리 요청</h2>
            <div className="mt-2 text-base">
              <b>{teacherLabel(request.requestedByName)}</b> · <b>{request.name}</b> {request.kind} · <b>{rangeLabel(request.start, request.end)}</b>
            </div>
            {request.memo ? <div className="mt-0.5 text-sm text-muted">메모: {request.memo}</div> : null}
          </div>
          {alarm ? (
            <button type="button" className={`btn ${muted ? "btn-ghost" : ""} shrink-0`} onClick={onToggleMute} title="이 팝업의 알림음만 끕니다">
              <IconVolume className="h-4 w-4" />
              {muted ? "알림 꺼짐" : "1분마다 알림"}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost shrink-0" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
        <div className="overflow-auto px-7 py-4">
          {!snap ? (
            <p className="text-sm text-muted">자리표 불러오는 중…</p>
          ) : free.length === 0 ? (
            <p className="mb-2 text-base font-bold text-alert">이 시간에 빈자리 없음 — 거절하거나 선생님과 시간을 바꿔 주세요.</p>
          ) : (
            <p className="mb-2 text-sm">
              {sel ? (
                <>
                  추천 자리 <b className="text-xl text-navy-800">{sel}</b>{" "}
                </>
              ) : (
                <b className="text-alert">자리를 골라 주세요 </b>
              )}
              <span className="text-xs text-muted">· 분홍 자리를 누르면 바꿔요 · 회색 = 그 시간에 누가 씀 (빈자리 {free.length}석)</span>
            </p>
          )}
          {snap ? (
            <SeatMap
              occ={new Map()}
              colors={new Map()}
              mark={(seat) => {
                if (seat === sel)
                  return { tone: "self", onClick: () => setSel(seat), content: <span className="mt-1.5 block text-sm font-extrabold">여기 ✓</span> };
                if (free.includes(seat)) return { tone: "pick", onClick: () => setSel(seat), content: <span className="mt-1.5 block text-sm font-extrabold">가능</span> };
                const who = seatBlocker(snap.dayUses, snap.day, seat, request.start, request.end);
                return {
                  tone: "block",
                  title: who ? `쓰는 사람: ${who.name} (${who.label} ${rangeLabel(who.start, who.end)})` : undefined,
                  content: <span className="mt-1.5 block text-[11px]">{who?.name ?? ""}</span>,
                };
              }}
            />
          ) : null}
        </div>
        {error ? <div className="border-t border-line bg-alert-soft px-7 py-3 text-sm font-semibold text-alert">{error}</div> : null}
        <div className="flex justify-end gap-2 border-t border-line bg-navy-50 px-7 py-4">
          <button type="button" className="btn px-5 py-2.5 text-base text-alert" onClick={() => void answer(false)} disabled={busy}>
            거절
          </button>
          <button type="button" className="btn btn-primary px-5 py-2.5 text-base" onClick={() => void answer(true)} disabled={busy || !sel}>
            {sel ? `${sel} 배정` : "배정"}
          </button>
        </div>
      </div>
    </div>
  );
}
