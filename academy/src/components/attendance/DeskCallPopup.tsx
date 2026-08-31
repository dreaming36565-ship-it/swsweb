"use client";

import { useState } from "react";
import PopupFrame from "./PopupFrame";
import { useAlarmLoop } from "../useAlarmLoop";
import { apiPost, errorMessage } from "@/lib/http";
import { STATUS_LABEL, type AttendanceEvent, type AttStatus } from "@/lib/types";

type Draft = { lateReason: string; eta: string };

const statusChip = (status: AttStatus) => {
  if (status === "PRESENT") return "border-present bg-present-soft text-present";
  if (status === "ABSENT") return "border-alert bg-alert-soft text-alert";
  if (status === "LATE") return "border-late bg-late-soft text-late";
  return "border-line bg-white text-muted";
};

export default function DeskCallPopup({
  event,
  muted,
  onToggleMute,
  onLater,
  onDone,
}: {
  event: AttendanceEvent;
  muted: boolean;
  onToggleMute: () => void;
  onLater: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      event.records.map((r) => [r.studentId, { lateReason: r.lateReason ?? "", eta: r.eta ?? "" }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useAlarmLoop(true, muted);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/attendance/submit", {
        eventId: event.id,
        step: "DESK",
        records: event.records.map((r) => ({
          studentId: r.studentId,
          status: r.status,
          lateReason: draft[r.studentId]?.lateReason ?? null,
          eta: draft[r.studentId]?.eta ?? null,
        })),
      });
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
      heading="출결전화 돌려주세요."
      muted={muted}
      onToggleMute={onToggleMute}
      error={error}
      note="체크되지 않은 친구들 전화 돌려주시고, 지각사유와 도착예정시간 남겨주세요."
      footer={
        <>
          <button type="button" className="btn" onClick={onLater} disabled={busy}>
            나중에
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? "저장 중…" : "저장 완료"}
          </button>
        </>
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold text-muted">
            <th className="w-36 py-2">이름</th>
            <th className="w-24 py-2 text-center">선생님 체크</th>
            <th className="py-2">지각 사유</th>
            <th className="w-36 py-2">도착예정시간</th>
          </tr>
        </thead>
        <tbody>
          {event.records.map((r) => {
            const d = draft[r.studentId] ?? { lateReason: "", eta: "" };
            const needsCall = r.status === "UNCHECKED";
            return (
              <tr
                key={r.studentId}
                className={`border-b border-line last:border-b-0 ${needsCall ? "bg-late-soft/40" : ""}`}
              >
                <td className="py-2.5 font-semibold text-ink">{r.studentName}</td>
                <td className="py-2.5 text-center">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${statusChip(r.status)}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                  {r.status === "ABSENT" && r.absentReason ? (
                    <div className="mt-1 text-[11px] text-muted">{r.absentReason}</div>
                  ) : null}
                </td>
                <td className="py-2.5 pr-2">
                  <input
                    className="field"
                    placeholder={needsCall ? "예) 학원 지각 / 병원 후 이동" : ""}
                    value={d.lateReason}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [r.studentId]: { ...d, lateReason: e.target.value } }))
                    }
                  />
                </td>
                <td className="py-2.5">
                  <input
                    className="field"
                    placeholder="예) 15:05"
                    value={d.eta}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [r.studentId]: { ...d, eta: e.target.value } }))
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">
        지각 사유나 도착예정시간을 입력하면 자동으로 <b>지각</b>으로 처리됩니다.
      </p>
    </PopupFrame>
  );
}
