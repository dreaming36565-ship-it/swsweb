// 교재 = 과정(학교급 + 학년-학기) + 교재 이름. 한 줄로 「초등 5-1 심화」 「중등 1-1 데메테르」 「고등 공통수학2 입」.
// 순수 함수 — 서버·화면 공용.

import type { Book } from "./types";

export const BOOK_LEVELS = ["초등", "중등", "고등"] as const;

/** 과정 (학년-학기 · 과목) */
export const BOOK_GRADES: Record<(typeof BOOK_LEVELS)[number], string[]> = {
  초등: ["3-1", "3-2", "4-1", "4-2", "5-1", "5-2", "6-1", "6-2"],
  중등: ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"],
  고등: ["공통수학1", "공통수학2", "대수", "미적분Ⅰ", "확률과 통계", "기하", "미적분Ⅱ"],
};

/** 「초등 5-1 심화」 → { level, grade, name }. 학교급이 없으면 null */
export function parseBook(text: string): { level: string; grade: string; name: string } | null {
  const s = String(text).trim().replace(/\s+/g, " ");
  const level = BOOK_LEVELS.find((l) => s.startsWith(`${l} `));
  if (!level) return null;
  const rest = s.slice(level.length + 1);
  const grade =
    [...BOOK_GRADES[level]].sort((a, b) => b.length - a.length).find((g) => rest === g || rest.startsWith(`${g} `)) ??
    rest.split(" ")[0];
  return { level, grade, name: rest.slice(grade.length).trim() };
}

type BookLike = Pick<Book, "level" | "grade" | "name">;
/** 「초등 5-1 심화」 — 입력 · 책장 */
export const bookFull = (b: BookLike) => `${b.level} ${b.grade}${b.name ? ` ${b.name}` : ""}`;
/** 「5-1 심화」 — 카드 · 표 */
export const bookShort = (b: BookLike) => `${b.grade}${b.name ? ` ${b.name}` : ""}`;
