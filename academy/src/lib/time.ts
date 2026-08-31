// 모든 시각은 "자정으로부터의 분(minute) 정수"로 저장·계산한다.
// 화면 표기는 24시간이 헷갈린다는 요청에 따라 전부 오전/오후(12시간)로 쓴다.

export const STEP = 10; // 10분 단위
export const DAY_START = 6 * 60; // 06:00
export const DAY_END = 23 * 60 + 50; // 23:50
export const NOON = 12 * 60;

export const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return h * 60 + m;
}

/** 내부용 24시간 문자열 — 저장·비교용이며 화면에는 쓰지 않는다 */
export function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type AmPm = "AM" | "PM";

export const MERIDIEM_LABEL: Record<AmPm, string> = { AM: "오전", PM: "오후" };

export function meridiemOf(min: number): AmPm {
  return min < NOON ? "AM" : "PM";
}

/** 12시간제 시(1~12) */
export function hour12(min: number): number {
  return Math.floor(min / 60) % 12 || 12;
}

/** "2:40" — 오전/오후 없이 시:분만 */
export function clockLabel(min: number): string {
  return `${hour12(min)}:${String(min % 60).padStart(2, "0")}`;
}

/** "오후 2:40" — 화면에 시각 하나를 보여줄 때 */
export function fmtTime(min: number): string {
  return `${MERIDIEM_LABEL[meridiemOf(min)]} ${clockLabel(min)}`;
}

/**
 * "오후 2:40 ~ 5:10" — 오전/오후가 같으면 뒤쪽 표기를 생략해 짧게 쓴다.
 * 다르면 "오전 11:30 ~ 오후 1:20" 처럼 둘 다 적는다.
 */
export function rangeLabel(start: number, end: number): string {
  const same = meridiemOf(start) === meridiemOf(end);
  return same ? `${fmtTime(start)} ~ ${clockLabel(end)}` : `${fmtTime(start)} ~ ${fmtTime(end)}`;
}

/** 10분 단위 시각 목록 — TimeSelect 용 */
export function timeOptions(from = DAY_START, to = DAY_END): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += STEP) out.push(m);
  return out;
}

/** 오전/오후 안에서 고를 수 있는 10분 단위 시각 목록 */
export function timeOptionsFor(ampm: AmPm): number[] {
  return timeOptions().filter((m) => meridiemOf(m) === ampm);
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

/** 8. 30 (일) — 좁은 자리에 날짜를 쓸 때 */
export function formatDateShort(key: string): string {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}. ${d.getDate()} (${DAY_LABELS[d.getDay()]})`;
}

/** 오후 10:24 — 대시보드 큰 시계 */
export function formatClock(d: Date): string {
  const min = minutesOfDay(d);
  return `${MERIDIEM_LABEL[meridiemOf(min)]} ${hour12(min)}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
