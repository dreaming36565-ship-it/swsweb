// 시간표 화면 공용 도우미 — 반(칸) 모양 다루기. 순수 함수.

import { bookShort } from "@/lib/books";
import { DAY_LABELS, rangeLabel } from "@/lib/time";
import { teacherLabel, type Book, type ClassModel, type ClassPart, type TempSwap } from "@/lib/types";

/** 학년 순서 — 피팅반(무학년제)은 그 학교급 맨 앞, 고등 누적오답은 고3 뒤 */
export const GRADE_ORDER = [
  "초등피팅", "초1", "초2", "초3", "초4", "초5", "초6",
  "중등피팅", "중1", "중2", "중3",
  "고등피팅", "고1", "고2", "고3",
  "누적오답", "숙제반", "개별",
];

/** 월~일 순서 */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
export const weekOrder = (d: number) => (d + 6) % 7;

/** 학년 → 학교급. 직접 입력한 학년은 반에 저장한 학교급 */
export function levelOf(c: Pick<ClassModel, "grade" | "level">): string {
  const g = c.grade ?? "";
  if (g === "누적오답") return "고등";
  if (g.startsWith("초")) return "초등";
  if (g.startsWith("중")) return "중등";
  if (g.startsWith("고")) return "고등";
  return c.level ?? "";
}

export const dayLabel = (days: number[]) => [...days].sort((a, b) => weekOrder(a) - weekOrder(b)).map((d) => DAY_LABELS[d]).join("·");

export function timeSpan(c: ClassModel): string {
  if (!c.parts.length) return "—";
  return rangeLabel(Math.min(...c.parts.map((p) => p.start)), Math.max(...c.parts.map((p) => p.end)));
}

export const isSwapped = (swaps: TempSwap[], classId: number, day: number) => swaps.some((s) => s.classId === classId && s.day === day);

/**
 * 그 요일의 칸. swapped 면 이번 주 그날만 수업 시간과 SR 시간을 맞바꿔 보여준다.
 */
export function partsOn(c: ClassModel, day: number, swapped = false): ClassPart[] {
  const on = c.parts.filter((p) => p.days.includes(day));
  if (!swapped) return on.sort((a, b) => a.start - b.start);
  const main = on.find((p) => p.kind === "CLASS");
  const sr = on.find((p) => p.kind === "SR");
  if (!main || !sr) return on;
  return [
    { ...main, start: sr.start, end: sr.end },
    { ...sr, start: main.start, end: main.end },
  ].sort((a, b) => a.start - b.start);
}

/** 수업 칸의 담당 선생님 (없으면 담임) */
export const mainTeacher = (c: ClassModel) => {
  const p = c.parts.find((x) => x.kind === "CLASS");
  return p ? { id: p.teacherId, name: p.teacherName } : { id: c.teacherId, name: c.teacherName };
};

/** 학습과정 — 칸에 넣은 교재의 짧은 이름 (없으면 반의 사용교재) */
export function course(c: ClassModel, books: Book[]): string {
  const names = [...new Set(c.parts.flatMap((p) => p.bookIds))]
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => !!b)
    .map(bookShort);
  return names.length ? names.join(", ") : c.textbook ?? "";
}

export const partBooks = (p: ClassPart, books: Book[]) =>
  p.bookIds
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => !!b)
    .map(bookShort)
    .join(", ");

/** 알파·수업이 함께 있어 순서를 바꿀 수 있는 반인가 */
export function swapPair(c: ClassModel, day: number) {
  const on = c.parts.filter((p) => p.days.includes(day));
  const main = on.find((p) => p.kind === "CLASS");
  const sr = on.find((p) => p.kind === "SR");
  return main && sr ? { main, sr } : null;
}

export function orderText(parts: ClassPart[]): string {
  const main = parts.find((p) => p.kind === "CLASS");
  const sr = parts.find((p) => p.kind === "SR");
  if (!main || !sr) return "";
  return sr.start < main.start
    ? `알파 ${rangeLabel(sr.start, sr.end)} → 수업 ${rangeLabel(main.start, main.end)}`
    : `수업 ${rangeLabel(main.start, main.end)} → 알파 ${rangeLabel(sr.start, sr.end)}`;
}

/** 겹치는 블록은 나란히 (lane) — 한 칸 안의 줄은 모두 같은 폭 */
export function lanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const ends: number[] = [];
  return sorted.map((it) => {
    let i = ends.findIndex((e) => e <= it.start);
    if (i < 0) i = ends.length;
    ends[i] = it.end;
    return { ...it, lane: i };
  });
}

/** 강의실 경고 key — 요일|강의실|시작|반이름 (다음 주에도 유지) */
export const alertKey = (day: number, roomName: string, start: number, className: string) => `${day}::${roomName}::${start}::${className}`;

/** 담당 표시 — 숙제반은 담당 선생님 없이 데스크가 출결을 맡는다 */
export const ownerLabel = (c: ClassModel) => (c.type === "HOMEWORK" ? "데스크" : teacherLabel(mainTeacher(c).name));

/** 시간표에 보일 반 — 학생이 0명인 반(예: 학생 없는 요일의 누적오답)은 숨긴다. 반 관리에서는 모두 보인다 */
export const withStudents = (classes: ClassModel[]) => classes.filter((c) => c.students.length > 0);
