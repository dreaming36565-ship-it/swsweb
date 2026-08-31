"use client";

// ★ 시간 입력은 이것만 쓴다. <input type="time"> 은 임의 분 단위가 들어와서 금지.
// 오전/오후를 먼저 고르고 시:분을 고르는 방식 (10분 단위, 오전 6:00 ~ 오후 11:50).

import {
  MERIDIEM_LABEL,
  clockLabel,
  meridiemOf,
  timeOptionsFor,
  type AmPm,
} from "@/lib/time";

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
  const ampm: AmPm | "" = value === null ? "" : meridiemOf(value);
  const options = ampm === "" ? [] : timeOptionsFor(ampm);

  /** 오전↔오후를 바꿔도 시:분은 최대한 유지한다 */
  const changeMeridiem = (next: AmPm | "") => {
    if (next === "") {
      onChange(null);
      return;
    }
    const list = timeOptionsFor(next);
    if (value === null) {
      onChange(list[0]);
      return;
    }
    const keep = list.find((m) => m % 720 === value % 720);
    onChange(keep ?? list[0]);
  };

  return (
    <div className={`flex gap-1.5 ${className}`}>
      <select
        id={id}
        className="field w-[5.5rem] shrink-0 px-2"
        value={ampm}
        disabled={disabled}
        onChange={(e) => changeMeridiem(e.target.value as AmPm | "")}
        aria-label="오전 오후"
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        <option value="AM">오전</option>
        <option value="PM">오후</option>
      </select>

      <select
        className="field min-w-0 flex-1 px-2"
        value={value === null ? "" : String(value)}
        disabled={disabled || ampm === ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        aria-label="시각"
      >
        {ampm === "" ? <option value="">—</option> : null}
        {options.map((m) => (
          <option key={m} value={m}>
            {clockLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 읽기 전용으로 시각을 보여줄 때 쓰는 라벨 (오전/오후 포함) */
export function meridiemLabel(min: number): string {
  return MERIDIEM_LABEL[meridiemOf(min)];
}
