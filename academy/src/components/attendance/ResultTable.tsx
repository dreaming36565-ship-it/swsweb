"use client";

// 출결 결과 표 — 지각·결석·연락 안 됨 학생만 보여준다.
// 알림함(🔔)에서 결과를 펼칠 때 쓴다. 관리자는 여러 반이 섞이므로 반 이름 칸을 함께 보여준다.

import { fmtTime } from "@/lib/time";
import type { AttendanceEvent, AttendanceRecord, AttStatus } from "@/lib/types";

const ISSUE: AttStatus[] = ["LATE", "ABSENT", "NO_CONTACT"];

export function statusChipClass(status: AttStatus): string {
  if (status === "PRESENT") return "border-present bg-present-soft text-present";
  if (status === "ABSENT") return "border-alert bg-alert-soft text-alert";
  if (status === "LATE") return "border-late bg-late-soft text-late";
  if (status === "NO_CONTACT") return "border-navy-400 bg-navy-100 text-navy-700";
  return "border-line bg-white text-muted";
}

/** "지각 · 오후 5:40" / "결석 (미리 연락)" / "지각 · 오후 5:52 도착" */
export function statusText(r: AttendanceRecord): string {
  if (r.status === "LATE" && r.arrivedAt !== null) return `지각 · ${fmtTime(r.arrivedAt)} 도착`;
  if (r.status === "LATE" && r.etaUnknown) return "지각 · 도착시간 모름";
  if (r.status === "LATE") return r.etaMin !== null ? `지각 · ${fmtTime(r.etaMin)} 도착 예정` : "지각";
  if (r.status === "ABSENT" && r.absentFrom) return "결석 (안 옴 → 변경)";
  if (r.status === "ABSENT") return r.preNotified ? "결석 (미리 연락)" : "결석";
  if (r.status === "NO_CONTACT") return "연락 안 됨 · 카톡 남김";
  if (r.status === "PRESENT") return r.arrivedAt !== null ? `출석 · 전화 중 도착` : "출석";
  return "미체크";
}

export function reasonText(r: AttendanceRecord): string {
  if (r.status === "LATE" && r.lateArrival) return "연락 안 됨 → 나중에 도착";
  if (r.status === "ABSENT" && r.absentFrom) return r.absentReason || "—";
  if (r.status === "NO_CONTACT") return "학생·학부모 부재중";
  return r.absentReason || r.lateReason || "—";
}

/** "학생 오후 5:13 부재중 / 학부모 오후 5:14 통화됨" */
export function contactLog(r: AttendanceRecord): string[] {
  if (r.preNotified) return ["결석 연락 받음"];
  const out: string[] = [];
  const word = (v: string | null) => (v === "OK" ? "통화됨" : "부재중");
  if (r.studentCall && r.studentCallAt !== null) out.push(`학생 ${fmtTime(r.studentCallAt)} ${word(r.studentCall)}`);
  if (r.parentCall && r.parentCallAt !== null) out.push(`학부모 ${fmtTime(r.parentCallAt)} ${word(r.parentCall)}`);
  if (r.kakaoAt !== null) out.push(`카톡 ${fmtTime(r.kakaoAt)} 남김`);
  return out;
}

export default function ResultTable({ events, showClass }: { events: AttendanceEvent[]; showClass: boolean }) {
  const items = events.flatMap((e) => e.records.filter((r) => ISSUE.includes(r.status)).map((r) => ({ e, r })));
  const all = events.flatMap((e) => e.records);
  const n = (s: AttStatus) => all.filter((r) => r.status === s).length;

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {[
          ["출석", n("PRESENT"), "text-present"],
          ["지각", n("LATE"), "text-late"],
          ["결석", n("ABSENT"), "text-alert"],
          ["연락 안 됨", n("NO_CONTACT"), "text-navy-700"],
        ].map(([label, value, tone]) => (
          <div key={label as string} className="rounded-lg border border-line px-2 py-2 text-center">
            <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}</div>
            <div className="text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">지각·결석 학생이 없습니다.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold text-muted">
              {showClass ? <th className="py-2 pr-2">반</th> : null}
              <th className="py-2 pr-2">이름</th>
              <th className="py-2 pr-2">상태</th>
              <th className="py-2 pr-2">사유</th>
              <th className="py-2">연락 기록</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ e, r }) => (
              <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                {showClass ? (
                  <td className="py-2 pr-2">
                    <div className="font-bold text-ink">{e.className}</div>
                    {e.teacherName ? <div className="text-[11px] text-muted">{e.teacherName}</div> : null}
                  </td>
                ) : null}
                <td className="py-2 pr-2 font-semibold text-ink">{r.studentName}</td>
                <td className="py-2 pr-2">
                  <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${statusChipClass(r.status)}`}>
                    {statusText(r)}
                  </span>
                </td>
                <td className="py-2 pr-2 text-ink">{reasonText(r)}</td>
                <td className="py-2 text-xs text-muted">
                  {contactLog(r).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {n("ABSENT") > 0 ? (
        <p className="mt-2 text-xs text-muted">결석 학생은 보강 관리에 자동으로 등록됩니다.</p>
      ) : null}
    </div>
  );
}
