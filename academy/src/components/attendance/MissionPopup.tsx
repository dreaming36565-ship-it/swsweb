"use client";

// 📄 미션지 요청 — 데스크가 SR 화면에서 요청하면 담당 선생님 화면(어느 메뉴든)에 뜬다.
// 뜰 때 3초 + 처리할 때까지 1분마다 3초 알림음. 「나중에」 없음.
// 바꾸면 안 되는 문구: 제목 `미션지 요청`, 내용 `{반이름} 미션지 없습니다. 준비해서 SR로 가져다주세요.`, 버튼 `전달완료`

import { useState } from "react";
import { WhoBadge } from "./PopupFrame";
import { useAlarmLoop } from "../useAlarmLoop";
import { IconVolume } from "../Icons";
import { apiPost, errorMessage } from "@/lib/http";
import { fmtTime, rangeLabel } from "@/lib/time";
import type { MissionRequest, SessionUser } from "@/lib/types";

export default function MissionPopup({
  user,
  request,
  muted,
  onToggleMute,
  onDone,
}: {
  user: SessionUser;
  request: MissionRequest;
  muted: boolean;
  onToggleMute: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useAlarmLoop(true, muted);

  const done = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/sr/action", { action: "MISSION", classId: request.classId, kind: "DONE" });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/45 p-6 fade-in print:hidden">
      <div className="card pop-in w-full max-w-lg overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-bold text-navy-900">미션지 요청</h2>
            <div className="mt-2 text-sm text-muted">
              <WhoBadge>{user.name} 선생님</WhoBadge>
              데스크 요청 · {request.className} SR {rangeLabel(request.start, request.end)} · {fmtTime(request.requestedAt)}
            </div>
          </div>
          <button type="button" className={`btn ${muted ? "btn-ghost" : ""} shrink-0`} onClick={onToggleMute} title="이 팝업의 알림음만 끕니다">
            <IconVolume className="h-4 w-4" />
            {muted ? "알림 꺼짐" : "1분마다 알림"}
          </button>
        </div>
        <div className="px-7 py-6 text-lg leading-relaxed text-ink">
          <b>{request.className}</b> 미션지 없습니다.
          <br />
          준비해서 SR로 가져다주세요.
        </div>
        {error ? <div className="border-t border-line bg-alert-soft px-7 py-3 text-sm font-semibold text-alert">{error}</div> : null}
        <div className="flex justify-end border-t border-line bg-navy-50 px-7 py-4">
          <button type="button" className="btn btn-primary px-5 py-2.5 text-base" onClick={() => void done()} disabled={busy}>
            전달완료
          </button>
        </div>
      </div>
    </div>
  );
}
