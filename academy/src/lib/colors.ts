// 반별 구분 색 — 시간표 블록·SR 좌석에서 반을 눈으로 구분하기 위한 용도.
// 디자인 토큰(navy/alert/present/late/srpink)과 겹치지 않는 연한 색만 쓴다.
// 같은 반의 수업 블록과 알파 블록은 반드시 같은 색이다.

const PALETTE = [
  { bg: "#DBEAFE", border: "#93C5FD", text: "#1E3A8A" }, // 파랑
  { bg: "#D1FAE5", border: "#6EE7B7", text: "#065F46" }, // 초록
  { bg: "#FFEDD5", border: "#FDBA74", text: "#9A3412" }, // 주황
  { bg: "#EDE9FE", border: "#C4B5FD", text: "#5B21B6" }, // 보라
  { bg: "#FEF9C3", border: "#FDE047", text: "#854D0E" }, // 노랑
  { bg: "#CCFBF1", border: "#5EEAD4", text: "#115E59" }, // 청록
  { bg: "#E0E7FF", border: "#A5B4FC", text: "#3730A3" }, // 남보라
  { bg: "#ECFCCB", border: "#BEF264", text: "#3F6212" }, // 연두
  { bg: "#F3E8FF", border: "#D8B4FE", text: "#6B21A8" }, // 자주
  { bg: "#E0F2FE", border: "#7DD3FC", text: "#075985" }, // 하늘
  { bg: "#FEF3C7", border: "#FCD34D", text: "#92400E" }, // 호박
  { bg: "#F1F5F9", border: "#CBD5E1", text: "#334155" }, // 회색
];

export type ClassColor = { bg: string; border: string; text: string };

/** "#RRGGBB" 를 흰색과 섞는다 (t = 흰색 비율) */
function mixWhite(hex: string, t: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
  return `rgb(${c.join(",")})`;
}

/** 운영 시간표용 옅은 반 색 — 바탕 55% · 테두리 35% 흰색과 섞음 (글자가 잘 보이게 차분하게) */
export const softColor = (c: ClassColor): ClassColor => ({ bg: mixWhite(c.bg, 0.55), border: mixWhite(c.border, 0.35), text: c.text });

/** 담당 선생님 고유 색 — 전체 반 카드 테두리 (선생님 순서대로 파랑·분홍·보라·초록·주황…) */
const TEACHER_COLORS = ["#2563EB", "#DB2777", "#7C3AED", "#059669", "#EA580C", "#0891B2", "#CA8A04"];
export const teacherColor = (index: number) => TEACHER_COLORS[Math.max(0, index) % TEACHER_COLORS.length];

/** 학교급 색 — 초등 · 중등 · 고등 */
export const LEVEL_COLOR: Record<string, string> = { 초등: "#1E9E5A", 중등: "#1B64DA", 고등: "#7C5CE6", E: "#1E9E5A", M: "#1B64DA", H: "#7C5CE6" };

export function classColor(classId: number): ClassColor {
  return PALETTE[Math.abs(classId) % PALETTE.length];
}

/**
 * 한 화면(하루)에 나오는 반들에게 서로 다른 색을 준다.
 * 반 id 순서로 팔레트를 차례대로 배정하므로 같은 요일이면 늘 같은 색이 나온다.
 */
export function classColorMap(classIds: number[]): Map<number, ClassColor> {
  const unique = [...new Set(classIds)].sort((a, b) => a - b);
  return new Map(unique.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
}

/** 📅 월간 스케줄 안내문(카톡용 그림) — 학원 색 · 수업 칸 색 · 행사 막대 색 (예전 스케줄러 그림과 같게) */
export const SCHED_BRAND = { U: "#3e7fa3", S: "#2b3a8a" } as const;
export const SCHED_CELL = { reg: "#dcebf4", ind: "#f9e6d3", free: "#efe3ef", regLab: "#a9d1e6", freeLab: "#d6c4e0" } as const;
export const SCHED_EVENT_COLORS = ["#fde68a", "#fbcfe8", "#bae6fd", "#fed7aa", "#ddd6fe", "#bbf7d0", "#fecaca", "#99f6e4", "#fef3c7", "#fcd34d", "#fef08a"];
/** 안내문 글씨 색 (✏️ 글씨 직접 고치기) */
export const SCHED_TEXT_COLORS = ["#dc2626", "#2563eb", "#3e7fa3", "#2b3a8a", "#d97706", "#16a34a", "#7c3aed", "#db2777", "#111827", "#6b7280"];
/** 안내문 고정 색 — 공휴일 · 토요일 · 옮김 글씨 · 안내 상자 테두리 */
export const SCHED_INK = { red: "#dc2626", blue: "#2563eb", move: "#92400e", gray: "#555555", line: "#e5e7eb", box: "#f1f2f4", infoU: "#9cc3dc", infoGray: "#d1d5db", badgeSub: "#fde68a", white: "#ffffff", term: "#d97706", ask: "#555555" } as const;
