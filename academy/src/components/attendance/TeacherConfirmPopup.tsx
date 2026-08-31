"use client";

import { useState } from "react";
import PopupFrame from "./PopupFrame";
import { apiPost, errorMessage } from "@/lib/http";
import { STATUS_LABEL, type AttendanceEvent, type AttStatus } from "@/lib/types";

const statusChip = (status: AttStatus) => {
  if (status === "PRESENT") return "border-present bg-present-soft text-present";
  if (status === "ABSENT") return "border-alert bg-alert-soft text-alert";
  if (status === "LATE") return "border-late bg-late-soft text-late";
  return "border-line bg-white text-muted";
};

/** 최종확인 단계는 알림음 대상이 아니다 (useAlarmLoop 를 걸지 않는다). */
export default function TeacherConfirmPopup({
  event,
  onLater,
  onDone,
}: {
  event: AttendanceEvent;
  muted: boolean;
  onToggleMute: () => void;
  onLater: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/attendance/submit", { eventId: event.id, step: "CONFIRM", records: [] });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PopupFrame
      event={event}
      heading="출결사항 확인해주세요."
      showMute={false}
      error={error}
      footer={
        <>
          <button type="button" className="btn" onClick={onLater} disabled={busy}>
            나중에
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? "처리 중…" : "확인 완료"}
          </button>
        </>
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold text-muted">
            <th className="w-36 py-2">이름</th>
            <th className="w-24 py-2 text-center">상태</th>
            <th className="py-2">사유</th>
            <th className="w-32 py-2">도착예정시간</th>
          </tr>
        </thead>
        <tbody>
          {event.records.map((r) => (
            <tr key={r.studentId} className="border-b border-line last:border-b-0">
              <td className="py-2.5 font-semibold text-ink">{r.studentName}</td>
              <td className="py-2.5 text-center">
                <span
                  className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${statusChip(r.status)}`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="py-2.5 text-ink">{r.absentReason || r.lateReason || "—"}</td>
              <td className="py-2.5 text-ink">{r.eta || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PopupFrame>
  );
}
