// 결석보강 규칙 — 순수 함수. 서버와 화면이 같은 규칙을 쓴다. DB 접근 금지.
//
// 유투엠 규칙 (2026-09-29 확정):
//   - 인정 = 학생에게 참석·불참 선택권이 없을 때 (갑자기 아픔·병원, 보호자가 정한 가족여행·가족행사·경조사, 학교 일정, 학원 사정=강사 결근)
//   - 개인사유 = 학생이 고를 수 있었을 때 (친구 생일파티 · 다른 학원 · 개인 약속) → 무단, 무료 보강 없음 (유료 보강 5,000콩알)
//   - 병결을 뺀 다른 사유를 당일에 알리면 무단. 무연락도 무단
//   - 잡아 둔 보강에 결석하면 다음 보강은 유료
//   - 이월 = 담당T가 최종적으로 보강 진행이 어렵다고 판단 → 관리자 승인(결재)해야 확정. 이월 뒤에는 보강하지 않는다
// 상태는 사람이 고르지 않는다 — 기록에서 저절로 정해진다.

import type { Absence, AbsenceCat, AbsenceNotice } from "./types";

/** 결석 사유 빠른 선택 — 고르면 구분이 저절로 정해진다 */
export const REASONS: Record<AbsenceCat, string[]> = {
  OK: ["병결", "병원 진료", "가족여행", "가족행사", "경조사", "학교 일정", "강사 결근 · 휴강"],
  PERSONAL: ["친구 생일 · 약속", "다른 학원 · 활동", "개인 일정"],
};

/** 목록에 있는 사유면 구분, 아니면 null (판정 필요) */
export function catOfReason(reason: string): AbsenceCat | null {
  const r = reason.trim();
  if (REASONS.OK.includes(r)) return "OK";
  if (REASONS.PERSONAL.includes(r)) return "PERSONAL";
  return null;
}

export const CAT_LABEL: Record<AbsenceCat, string> = { OK: "인정", PERSONAL: "개인사유" };
export const NOTICE_LABEL: Record<AbsenceNotice, string> = { PRE: "미리 알림", SAME_DAY: "당일 알림", NONE: "무연락" };

const SICK = /병|진료|아파|두통|열|조퇴/;

export type Verdict = "판정 필요" | "무단" | "인정";
export type MakeupStatus = "이월" | "이월 대기" | "무단" | "조율중" | "보강 완료" | "보강 전";
export const STATUS_ORDER: MakeupStatus[] = ["조율중", "보강 전", "보강 완료", "이월 대기", "이월", "무단"];

type A = Pick<Absence, "cat" | "notice" | "reason" | "paid" | "more" | "rounds" | "carried" | "carryReq" | "rejected" | "dream" | "department" | "date">;

export function verdictOf(a: A): Verdict {
  if (!a.cat) return "판정 필요";
  if (a.cat === "PERSONAL") return "무단";
  if (a.notice === "NONE") return "무단";
  if (a.notice === "SAME_DAY" && !SICK.test(a.reason)) return "무단";
  return "인정";
}

/** 보강 결석(MISSED)은 빼고 센다 */
export const liveRounds = (a: A) => a.rounds.filter((r) => r.state !== "MISSED");

export function statusOf(a: A): MakeupStatus {
  if (a.carried) return "이월";
  if (a.carryReq) return "이월 대기";
  if (verdictOf(a) === "무단" && !a.paid) return "무단";
  const rs = liveRounds(a);
  if (!rs.length) return "조율중";
  if (rs.every((r) => r.state === "DONE") && !a.more) return "보강 완료";
  return "보강 전";
}

/** 초중등부만 드림플러스 체크 (고등부 에듀OK 기록은 중단 → 이 앱에만) */
export const usesDreamPlus = (a: Pick<Absence, "department">) => a.department === "ELEM";

/** 처리할 일 표시 */
export function flagsOf(a: A, today: string): string[] {
  const f: string[] = [];
  if (!a.cat) f.push("판정 필요 — 관리자");
  if (a.rounds.some((r) => r.state === "PLANNED" && r.type === "MAKEUP" && r.date && r.date < today)) f.push("완료 체크 필요");
  if (statusOf(a) === "보강 완료" && !a.dream && usesDreamPlus(a)) f.push("드림+ 기록 안 함");
  if (a.rounds.some((r) => r.state === "MISSED") && !a.paid && statusOf(a) !== "보강 완료") f.push("보강 결석 → 다음은 유료");
  if (a.rejected && !a.carryReq && !a.carried) f.push("이월 반려");
  return f;
}

export const isOpen = (a: A, today: string) =>
  ["조율중", "보강 전", "이월 대기"].includes(statusOf(a)) || flagsOf(a, today).length > 0;

/** 보강이 끝난 날 (결석관리 "9/23 보강완료") */
export function doneDateOf(a: A): string | null {
  if (statusOf(a) !== "보강 완료") return null;
  const dates = a.rounds.filter((r) => r.state === "DONE" && r.date).map((r) => r.date!);
  return dates.sort().at(-1) ?? null;
}
