// 반별 구분 색 — 시간표 블록·SR 좌석에서 반을 눈으로 구분하기 위한 용도.
// 디자인 토큰(navy/alert/present/late/srpink)과 겹치지 않는 연한 색만 쓴다.

const PALETTE = [
  { bg: "#EEF2FF", border: "#C7D2FE", text: "#3730A3" },
  { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
  { bg: "#FFF7ED", border: "#FED7AA", text: "#9A3412" },
  { bg: "#F5F3FF", border: "#DDD6FE", text: "#5B21B6" },
  { bg: "#F0F9FF", border: "#BAE6FD", text: "#075985" },
  { bg: "#FEFCE8", border: "#FDE68A", text: "#854D0E" },
  { bg: "#FDF2F8", border: "#FBCFE8", text: "#9D174D" },
  { bg: "#F0FDFA", border: "#99F6E4", text: "#115E59" },
];

export type ClassColor = { bg: string; border: string; text: string };

export function classColor(classId: number): ClassColor {
  return PALETTE[Math.abs(classId) % PALETTE.length];
}
