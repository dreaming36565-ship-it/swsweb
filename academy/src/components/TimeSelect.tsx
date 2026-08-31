"use client";

// ★ 시간 입력은 이것만 쓴다. <input type="time"> 은 임의 분 단위가 들어와서 금지.
// 06:00 ~ 23:50, 10분 단위.

import { timeOptions, toHHMM } from "@/lib/time";

export default function TimeSelect({
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "선택",
  disabled = false,
  className = "",
  id,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      className={`field ${className}`}
      value={value === null ? "" : String(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {timeOptions().map((m) => (
        <option key={m} value={m}>
          {toHHMM(m)}
        </option>
      ))}
    </select>
  );
}
