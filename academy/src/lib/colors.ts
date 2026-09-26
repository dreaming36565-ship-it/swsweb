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
