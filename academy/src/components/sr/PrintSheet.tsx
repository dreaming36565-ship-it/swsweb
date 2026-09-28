"use client";

// 🖨 좌석표 인쇄 — 기존 시트처럼 A4 가로 2장(월수금 한 장 / 화목토 한 장).
// 요일마다 SR 시작 시각(1st, 2nd…)별 작은 자리표: 왼쪽 반·선생님(반 색), 오른쪽 A~D열 × 6줄, 칠판은 아래.
// 시간 칸이 많은 요일이 있어도 한 장에 들어가게 저절로 줄인다.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SEAT_COLS, SEAT_ROWS, occupantsAt } from "@/lib/sr";
import { classColorMap } from "@/lib/colors";
import { DAY_LABELS, clockLabel, dateKey } from "@/lib/time";
import type { SrSnapshot } from "@/lib/repo/sr";

const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
/** 안예슬 → 예슬T (시트 표기) */
const shortTeacher = (name: string | null) => (name ? `${name.slice(1)}T` : "");

function SlotCards({ snap, day }: { snap: SrSnapshot; day: number }) {
  const blocks = snap.blocks.filter((b) => b.day === day);
  const colors = classColorMap(snap.dayClassIds[day] ?? []);
  const starts = [...new Set(blocks.map((b) => b.start))].sort((a, b) => a - b);
  return (
    <>
      {starts.map((s, i) => {
        const active = blocks.filter((b) => b.start <= s && s < b.end).sort((a, b) => a.start - b.start);
        const end = Math.min(...blocks.filter((b) => b.start === s).map((b) => b.end));
        const occ = occupantsAt(snap.weekUses, day, s);
        return (
          <div key={s} className="flex border-[1.5px] border-black">
            <div className="w-[30mm] border-r border-black p-[1mm] text-[6.5pt] leading-[1.35]">
              <b className="text-[7.5pt]">
                {DAY_LABELS[day]} {ORD[i] ?? `${i + 1}th`}
              </b>
              <div>
                {clockLabel(s)}~{clockLabel(end)}
              </div>
              {active.map((b) => {
                const c = colors.get(b.classId);
                const cls = snap.classes.find((x) => x.id === b.classId);
                const own = b.start === s && b.end === end ? "" : ` (${clockLabel(b.start)}~${clockLabel(b.end)})`;
                return (
                  <div key={b.classId} className="mt-[0.5mm] rounded-[1mm] px-[1mm] font-bold" style={{ background: c?.bg, color: c?.text }}>
                    {cls?.name} {shortTeacher(cls?.teacherName ?? null)}
                    {own}
                  </div>
                );
              })}
            </div>
            <table className="flex-1 table-fixed border-collapse text-[6.5pt]">
              <tbody>
                {Array.from({ length: SEAT_ROWS }, (_, k) => SEAT_ROWS - k).map((r) => (
                  <tr key={r}>
                    <th className="w-[4mm] text-[6pt] font-semibold text-muted">{r}</th>
                    {SEAT_COLS.map((col) => {
                      const o = occ.get(`${col}${r}`);
                      const c = o?.classId ? colors.get(o.classId) : undefined;
                      return (
                        <td key={col} className="h-[3.2mm] overflow-hidden whitespace-nowrap border border-[#ccc] text-center font-semibold leading-[3mm]" style={c ? { background: c.bg, color: c.text } : undefined}>
                          {o?.name ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th />
                  {SEAT_COLS.map((c) => (
                    <th key={c} className="text-[6pt] font-semibold text-muted">
                      {c}
                    </th>
                  ))}
                </tr>
                <tr>
                  <td />
                  <td colSpan={4} className="border border-navy-900 bg-navy-900 text-center font-extrabold text-white">
                    칠판
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function Page({ snap, days, title }: { snap: SrSnapshot; days: number[]; title: string }) {
  return (
    <div className="print-page mx-auto mb-3 w-[281mm] border border-line bg-white p-[4mm] print:m-0 print:border-0 print:p-0">
      <div className="mb-[3mm] text-center text-[15pt] font-extrabold">{title}</div>
      <div className="grid items-start gap-[2.5mm]" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
        {days.map((d) => (
          <div key={d} className="space-y-[2.5mm]">
            <SlotCards snap={snap} day={d} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PrintSheet({ snap, onClose }: { snap: SrSnapshot; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const month = new Date().getMonth() + 1;
  // A4 가로 한 장(인쇄 가능 높이 약 196mm)에 들어가게 줄인다
  useEffect(() => {
    const MAX = 196 * 3.7795;
    for (const p of ref.current?.querySelectorAll<HTMLElement>(".print-page") ?? []) {
      p.style.zoom = "";
      const h = p.getBoundingClientRect().height;
      if (h > MAX) p.style.zoom = String(MAX / h);
    }
  }, [snap]);
  return createPortal(
    <div className="print-root fixed inset-0 z-[80] overflow-auto bg-navy-950/45 p-6 print:static print:overflow-visible print:bg-white print:p-0">
      <div className="mx-auto max-w-[1180px] rounded-xl bg-white p-5 print:max-w-none print:rounded-none print:p-0">
        <div className="mb-3 flex items-center justify-between print:hidden">
          <div>
            <h2 className="text-lg font-bold text-navy-900">🖨 좌석표 인쇄 미리보기</h2>
            <p className="text-sm text-muted">A4 가로 2장 (월수금 · 화목토) · PDF로 저장할 때 파일 이름: 유투엠_SR_자리배치표_{dateKey(new Date())}.pdf</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              인쇄 / PDF로 저장
            </button>
            <button type="button" className="btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        <div ref={ref}>
          <Page snap={snap} days={[1, 3, 5]} title={`${month}월 SR 좌석배치표_월수금`} />
          <Page snap={snap} days={[2, 4, 6]} title={`${month}월 SR 좌석배치표_화목토`} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
