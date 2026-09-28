"use client";

import { useEffect, type ReactNode } from "react";
import { IconClose } from "./Icons";

export default function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
  closable = true,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  closable?: boolean;
}) {
  useEffect(() => {
    if (!open || !closable || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closable, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-6 fade-in print:hidden">
      <div
        className="card pop-in flex max-h-[88vh] w-full flex-col overflow-hidden"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-ink">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          </div>
          {closable && onClose ? (
            <button type="button" className="btn btn-ghost px-2 py-1" onClick={onClose} aria-label="닫기">
              <IconClose />
            </button>
          ) : null}
        </div>
        <div className="flex-1 overflow-auto px-6 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-navy-50/60 px-6 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
