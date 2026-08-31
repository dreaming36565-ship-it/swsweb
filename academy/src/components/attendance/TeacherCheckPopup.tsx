"use client";

import { useState } from "react";
import PopupFrame from "./PopupFrame";
import { useAlarmLoop } from "../useAlarmLoop";
import { apiPost } from "@/lib/http";
import { errorMessage } from "@/lib/http";
import type { AttendanceEvent, AttStatus } from "@/lib/types";

type Draft = { status: AttStatus; absentReason: string };

export default function TeacherCheckPopup({
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
      event.records.map((r) => [r.studentId, { status: r.status, absentReason: r.absentReason ?? "" }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useAlarmLoop(true, muted);

  // 출석·결석은 동시에 체크되지 않는다. 같은 걸 다시 누르면 미체크로 돌아간다.
  const toggle = (studentId: number, status: Exclude<AttStatus, "UNCHECKED" | "LATE">) => {
    setDraft((d) => {
      const cur = d[studentId] ?? { status: "UNCHECKED" as AttStatus, absentReason: "" };
      const next: Draft =
        cur.status === status
          ? { status: "UNCHECKED", absentReason: "" }
          : { status, absentReason: status === "ABSENT" ? cur.absentReason : "" };
      return { ...d, [studentId]: next };
    });
  };

  const submit = async () => {
    setError(null);
    const missing = event.records.find(
      (r) => draft[r.studentId]?.status === "ABSENT" && !draft[r.studentId]?.absentReason.trim(),
    );
    if (missing) {
      setError(`${missing.studentName} 학생의 결석 사유를 입력해 주세요.`);
      return;
    }
    setBusy(true);
    try {
      await apiPost("/api/attendance/submit", {
        eventId: event.id,
        step: "TEACHER",
        records: event.records.map((r) => ({
          studentId: r.studentId,
          status: draft[r.studentId]?.status ?? "UNCHECKED",
          absentReason: draft[r.studentId]?.absentReason ?? null,
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
      heading="출석체크해주세요."
      muted={muted}
      onToggleMute={onToggleMute}
      error={error}
      note="출결 상황을 아직 모르는 학생은 체크하지 않고 두시면, 데스크에서 전화로 확인합니다."
      footer={
        <>
          <button type="button" className="btn" onClick={onLater} disabled={busy}>
            나중에
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "제출 중…" : "제출 완료"}
          </button>
        </>
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold text-muted">
            <th className="w-40 py-2">이름</th>
            <th className="w-24 py-2 text-center">출석</th>
            <th className="w-24 py-2 text-center">결석</th>
            <th className="py-2">결석 사유</th>
          </tr>
        </thead>
        <tbody>
          {event.records.map((r) => {
            const d = draft[r.studentId] ?? { status: "UNCHECKED" as AttStatus, absentReason: "" };
            return (
              <tr key={r.studentId} className="border-b border-line last:border-b-0">
                <td className="py-2.5 font-semibold text-ink">{r.studentName}</td>
                <td className="py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => toggle(r.studentId, "PRESENT")}
                    className={`h-7 w-7 rounded-md border text-sm font-bold transition-colors ${
                      d.status === "PRESENT"
                        ? "border-present bg-present text-white"
                        : "border-line bg-white text-muted hover:bg-present-soft"
                    }`}
                    aria-label={`${r.studentName} 출석`}
                  >
                    {d.status === "PRESENT" ? "✓" : ""}
                  </button>
                </td>
                <td className="py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => toggle(r.studentId, "ABSENT")}
                    className={`h-7 w-7 rounded-md border text-sm font-bold transition-colors ${
                      d.status === "ABSENT"
                        ? "border-alert bg-alert text-white"
                        : "border-line bg-white text-muted hover:bg-alert-soft"
                    }`}
                    aria-label={`${r.studentName} 결석`}
                  >
                    {d.status === "ABSENT" ? "✓" : ""}
                  </button>
                </td>
                <td className="py-2.5 pl-2">
                  <input
                    className="field"
                    placeholder={d.status === "ABSENT" ? "결석 사유 (필수)" : "결석 체크 시 입력"}
                    value={d.absentReason}
                    disabled={d.status !== "ABSENT"}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [r.studentId]: { ...d, absentReason: e.target.value },
                      }))
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PopupFrame>
  );
}
