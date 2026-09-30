"use client";

// 🖨 운영 시간표 인쇄 — 한 쪽에 한 장(요일 하나 = A4 세로 · 선생님 한 주 = A4 가로). 넘치면 저절로 줄여 한 장에 맞춘다.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A4 인쇄 가능 영역 (여백 5mm) */
const MM = 3.7795;
const AREA = { portrait: [200 * MM, 287 * MM], landscape: [287 * MM, 200 * MM] } as const;

export default function OpsPrint({
  title,
  pages,
  landscape = false,
  onClose,
}: {
  title: string;
  pages: { key: string; node: ReactNode }[];
  landscape?: boolean;
  onClose: () => void;
}) {
  const [pageW, pageH] = AREA[landscape ? "landscape" : "portrait"];
  const ref = useRef<HTMLDivElement>(null);

  // 넓은 시간표도 A4 한 장에 들어가게 줄인다
  useEffect(() => {
    for (const p of ref.current?.querySelectorAll<HTMLElement>(".ops-page") ?? []) {
      p.style.zoom = "";
      const r = p.getBoundingClientRect();
      const z = Math.min(1, pageW / r.width, pageH / r.height);
      if (z < 1) p.style.zoom = String(z);
    }
  }, [pages, pageW, pageH]);

  // 이 미리보기가 열려 있는 동안만 이 방향으로 (기본 인쇄 설정은 SR 좌석표용 가로)
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@media print { @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 5mm; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [landscape]);

  return createPortal(
    <div className="fixed inset-0 z-[80] overflow-auto bg-navy-950/45 p-6 print:static print:overflow-visible print:bg-white print:p-0">
      <div className="mx-auto w-fit min-w-[820px] rounded-xl bg-white p-5 print:min-w-0 print:rounded-none print:p-0">
        <div className="mb-3 flex items-center justify-between gap-4 print:hidden">
          <div>
            <h2 className="text-lg font-bold text-navy-900">🖨 {title}</h2>
            <p className="text-sm text-muted">A4 {landscape ? "가로" : "세로"} · {pages.length}장 · 한 장에 안 들어가면 저절로 줄여요</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => window.print()} autoFocus>
              인쇄 / PDF로 저장
            </button>
            <button type="button" className="btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        <div ref={ref}>
          {pages.map((p) => (
            <div key={p.key} className="ops-page print-page mb-4 w-max border border-dashed border-line p-2 print:m-0 print:border-0 print:p-0">
              {p.node}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
