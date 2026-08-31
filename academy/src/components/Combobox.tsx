"use client";

// ★ 선택 + 직접 입력(신규 생성) 겸용 입력창.
// 목록에 없는 값을 타이핑하면 "새로 만들기"로 처리된다.

import { useEffect, useMemo, useRef, useState } from "react";

export type ComboOption = { id: number; label: string; hint?: string };

/** id 가 있으면 기존 항목, 없으면 name 으로 새로 만든다 */
export type ComboValue = { id: number | null; name: string };

export default function Combobox({
  options,
  value,
  onChange,
  placeholder = "선택하거나 직접 입력",
  allowCreate = true,
  disabled = false,
  id,
}: {
  options: ComboOption[];
  value: ComboValue;
  onChange: (value: ComboValue) => void;
  placeholder?: string;
  allowCreate?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value.name);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value.name);
  }, [value.id, value.name]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, text]);

  const exact = options.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());
  const showCreate = allowCreate && text.trim().length > 0 && !exact;

  return (
    <div className="relative" ref={boxRef}>
      <input
        id={id}
        className="field"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          setOpen(true);
          const hit = options.find((o) => o.label.toLowerCase() === next.trim().toLowerCase());
          onChange(hit ? { id: hit.id, name: hit.label } : { id: null, name: next });
        }}
      />
      {open && !disabled ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {filtered.length === 0 && !showCreate ? (
            <div className="px-3 py-2 text-sm text-muted">일치하는 항목이 없습니다.</div>
          ) : null}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-navy-50"
              onClick={() => {
                onChange({ id: o.id, name: o.label });
                setText(o.label);
                setOpen(false);
              }}
            >
              <span className="text-ink">{o.label}</span>
              {o.hint ? <span className="text-xs text-muted">{o.hint}</span> : null}
            </button>
          ))}
          {showCreate ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-navy-700 hover:bg-navy-50"
              onClick={() => {
                onChange({ id: null, name: text.trim() });
                setOpen(false);
              }}
            >
              <span className="font-semibold">새로 만들기</span>
              <span className="text-ink">{text.trim()}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
