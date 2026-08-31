// 모든 시각은 "자정으로부터의 분(minute) 정수"로 저장·계산한다.
// 문자열 "14:40" 은 UI 입출력에서만 쓴다.

export const STEP = 10; // 10분 단위
export const DAY_START = 6 * 60; // 06:00
export const DAY_END = 23 * 60 + 50; // 23:50

export const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return h * 60 + m;
}

export function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function rangeLabel(start: number, end: number): string {
  return `${toHHMM(start)} ~ ${toHHMM(end)}`;
}

/** 10분 단위 시각 목록 — TimeSelect 용 */
export function timeOptions(from = DAY_START, to = DAY_END): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += STEP) out.push(m);
  return out;
}

/** 두 구간이 겹치는가 (끝점은 겹침으로 보지 않는다) */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 10분 단위로 내림 */
export function floorStep(min: number): number {
  return Math.floor(min / STEP) * STEP;
}

/** 10분 단위로 올림 */
export function ceilStep(min: number): number {
  return Math.ceil(min / STEP) * STEP;
}

/** YYYY-MM-DD (로컬 기준) */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map((v) => parseInt(v, 10));
  return new Date(y, m - 1, d);
}

/** 2026. 08. 30 (일) */
export function formatDateKorean(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}. ${m}. ${day} (${DAY_LABELS[d.getDay()]})`;
}

/** 10:24 AM */
export function formatClock(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${m} ${ampm}`;
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
