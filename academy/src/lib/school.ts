// 🏫 학교 학사일정 규칙 — 순수 함수 (서버 · 화면 공용). DB 접근 금지.
//
// 학교마다 항목(1학기 중간 · 여름방학식 …) = 날짜 칸 여러 개(학년마다 다를 수 있음).
// 학년도 = 3월 ~ 다음 해 2월. 시트 글자 「2~3학년 : 9/28(월) ~ 29(화)」를 날짜로 바꿀 때 씀.

export type SchoolLevel = "H" | "M" | "E";
export const LEVEL_LABEL: Record<SchoolLevel, string> = { H: "고등", M: "중등", E: "초등" };
export const LEVELS: SchoolLevel[] = ["H", "M", "E"];

/** 색 묶음 — ex 시험 · vac 방학·개학·졸업 · off 쉬는 날 · ev 행사 · sn 수능 */
export type EventCat = "ex" | "vac" | "off" | "ev" | "sn";
export const CAT_LABEL: Record<EventCat, string> = { ex: "시험", vac: "방학·개학·졸업", off: "쉬는 날", ev: "행사", sn: "수능" };

const CAT: Record<string, EventCat> = {
  "1학기 중간": "ex",
  "1학기 기말": "ex",
  "2학기 중간": "ex",
  "2학기 기말": "ex",
  수능: "sn",
  여름방학식: "vac",
  개학: "vac",
  "여름방학 개학": "vac",
  겨울방학식: "vac",
  졸업식: "vac",
  종업식: "vac",
  개교기념일: "off",
  재량휴업일: "off",
  수학여행: "ev",
  체육대회: "ev",
  축제: "ev",
};
/** 목록에 없는 항목(＋ 일정 추가로 넣은 학부모총회 등)은 행사 */
export const catOf = (kind: string): EventCat => CAT[kind] ?? "ev";

/** 학교별 표의 칸 (시트 오른쪽 표 그대로) */
export const COLS: Record<SchoolLevel, string[]> = {
  H: ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말", "개교기념일", "수학여행", "체육대회", "축제", "여름방학식", "개학", "수능", "겨울방학식", "졸업식", "종업식"],
  M: ["1학기 중간", "1학기 기말", "여름방학식", "개학", "2학기 중간", "2학기 기말", "겨울방학식", "졸업식", "종업식"],
  E: ["개교기념일", "재량휴업일", "여름방학식", "여름방학 개학", "겨울방학식", "졸업식", "종업식"],
};

/** 교과서(출판사) 칸 */
export const BOOK_SUBJECTS: Partial<Record<SchoolLevel, string[]>> = {
  H: ["공통수학1", "공통수학2", "대수", "미적분1", "기하", "고3미적분", "고3확률과 통계"],
  M: ["중1 수학", "중2 수학", "중3 수학"],
};

/** 학교 × 날짜 막대에 쓰는 짧은 이름 */
const SHORT: Record<string, string> = {
  "1학기 중간": "중간",
  "1학기 기말": "기말",
  "2학기 중간": "중간",
  "2학기 기말": "기말",
  여름방학식: "방학식",
  겨울방학식: "방학식",
  "여름방학 개학": "개학",
};
export const shortKind = (kind: string) => SHORT[kind] ?? kind;

export const GRADE_OPTIONS = ["1학년", "2학년", "3학년", "1~2학년", "2~3학년", "1, 3학년"];

export type SchoolRange = { grades: string | null; from: string; to: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** 학년도 첫해(3월이 속한 해) — 1 · 2월은 그 전 해 학년도 */
export const schoolYearOf = (date: string) => (Number(date.slice(5, 7)) >= 3 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1);

/**
 * 시트 글자 → 날짜 칸. 「-」 · 빈칸 = 없음([]).
 * 예: 「4/27(월) ~ 5/4(월)」 · 「2~3학년 : 9/28(월) ~ 29(화)」 · 「5/4(월) / 10/5(월)」 · 줄바꿈으로 학년마다.
 * year = 학년도 첫해 (3~12월 = year, 1~2월 = year + 1)
 */
export function parseCell(text: string | null | undefined, year: number): SchoolRange[] {
  if (!text || text.trim() === "-") return [];
  const out: SchoolRange[] = [];
  const iso = (m: number, d: number) => `${m >= 3 ? year : year + 1}-${pad(m)}-${pad(d)}`;
  for (let part of text.split(/\n| \/ /)) {
    part = part.trim();
    if (!part) continue;
    let grades: string | null = null;
    const g = part.match(/^(.*?학년)\s*:?\s*/);
    if (g) {
      grades = g[1].trim();
      part = part.slice(g[0].length);
    }
    const m = part.match(/(\d{1,2})\/(\d{1,2})\([^)]*\)\s*(?:~\s*(?:(\d{1,2})\/)?(\d{1,2})\([^)]*\))?/);
    if (!m) continue;
    const m1 = Number(m[1]);
    const d1 = Number(m[2]);
    const m2 = m[3] ? Number(m[3]) : m1;
    const d2 = m[4] ? Number(m[4]) : d1;
    out.push({ grades, from: iso(m1, d1), to: iso(m2, d2) });
  }
  return out;
}

const DOW = "일월화수목금토";
const dow = (d: string) => new Date(`${d}T00:00:00`).getDay();
const mdw = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${DOW[dow(d)]})`;

/** 화면 글자 — 「2~3학년 9/28(월) ~ 9/29(화)」 */
export function rangeText(r: SchoolRange): string {
  return `${r.grades ? `${r.grades} ` : ""}${mdw(r.from)}${r.to !== r.from ? ` ~ ${mdw(r.to)}` : ""}`;
}

export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00`);
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);

/** 시험대비 알림 — 시험 D-40 */
export const EXAM_ALERT_DAYS = 40;
