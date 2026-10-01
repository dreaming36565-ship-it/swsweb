// 출결 규칙 — 순수 함수. 서버(repo.ts)와 팝업(클라이언트)이 같은 규칙을 쓴다. DB 접근 금지.
//
// 학원 출결 순서:
//   1차 출석체크(왔음 체크 / 결석 연락 받음)
//   → 안 온 학생: 학생 전화 → (부재중이면) 학부모 전화 → (부재중이면) 어머니께 카톡
//   → 통화되면 지각(사유+도착예정시간) 또는 결석(사유)

import type { AttendanceRecord, AttStatus, CallState, Checker, SessionType } from "./types";

/**
 * 출결이 시작되는 시각과 1차 체크 담당 — 알파가 먼저면 데스크, 아니면 담당 선생님. 숙제반은 늘 데스크.
 * alphaIsSr = 0 이면 알파 칸이 교실 = 두 번째 수업(수업+수업) → 먼저 시작하는 수업에 담당 선생님.
 */
export function triggerOf(s: { startMin: number; alphaStartMin: number | null; alphaIsSr?: number; type?: SessionType }): {
  triggerMin: number;
  checker: Checker;
} {
  if (s.type === "HOMEWORK") return { triggerMin: Math.min(s.startMin, s.alphaStartMin ?? s.startMin), checker: "DESK" };
  if (s.alphaIsSr === 0) return { triggerMin: Math.min(s.startMin, s.alphaStartMin ?? s.startMin), checker: "TEACHER" };
  if (s.alphaStartMin !== null && s.alphaStartMin < s.startMin) {
    return { triggerMin: s.alphaStartMin, checker: "DESK" };
  }
  return { triggerMin: s.startMin, checker: "TEACHER" };
}

export function callStateOf(r: AttendanceRecord): CallState {
  return {
    studentCall: r.studentCall,
    parentCall: r.parentCall,
    kakao: r.kakaoAt !== null,
    arrived: r.arrivedAt !== null,
    callResult: r.callResult,
    reason: (r.callResult === "LATE" ? r.lateReason : r.absentReason) ?? "",
    absentCat: r.callResult === "ABSENT" ? r.absentCat : null,
    etaMin: r.etaMin,
    etaUnknown: r.etaUnknown === 1,
  };
}

/** 학생이나 학부모 중 누군가와 통화가 됐는가 */
export const isReached = (c: CallState) => c.studentCall === "OK" || c.parentCall === "OK";

/**
 * 남은 인원 = 아직 아무와도 연락이 닿지 않은 학생.
 * 도착했거나, 통화가 됐거나(지각·결석), 둘 다 부재중이라 카톡까지 남겼으면 빠진다.
 */
export const isRemaining = (c: CallState) => !c.arrived && !isReached(c) && !c.kakao;

/** 통화는 됐는데 지각/결석 정보가 아직 비어 있는가 */
export function needsInfo(c: CallState): boolean {
  if (c.arrived || !isReached(c)) return false;
  if (c.callResult === "ABSENT") return !c.reason.trim();
  // 지각은 도착예정시간을 고르거나 "모름" 을 눌러야 한다 (학부모도 모르는 경우)
  if (c.callResult === "LATE") return !c.reason.trim() || (c.etaMin === null && !c.etaUnknown);
  return true;
}

/**
 * 버튼 순서를 지키도록 상태를 정리한다.
 * 앞 단계를 바꾸거나 취소하면 뒤 단계는 함께 지운다 (학생 부재중을 취소하면 학부모 전화·카톡도 지워짐).
 */
export function normalizeCall(c: CallState): CallState {
  const next = { ...c };
  if (next.studentCall !== "MISS") next.parentCall = null;
  if (!(next.studentCall === "MISS" && next.parentCall === "MISS")) next.kakao = false;
  if (!isReached(next)) {
    next.callResult = null;
    next.reason = "";
    next.absentCat = null;
    next.etaMin = null;
  }
  if (next.callResult !== "ABSENT") next.absentCat = null;
  if (next.callResult !== "LATE") {
    next.etaMin = null;
    next.etaUnknown = false;
  }
  if (next.etaUnknown) next.etaMin = null;
  return next;
}

/** 도착 처리가 필요한 지각 — 도착시간을 몰라서 아직 실제 도착 시각이 없는 학생 */
export const awaitingArrival = (r: AttendanceRecord) =>
  r.status === "LATE" && r.etaUnknown === 1 && !r.lateArrival && r.arrivedAt === null;

/** [결석으로 변경] 할 수 있는가 — 연락 안 됨, 또는 도착시간을 모르는 지각이 끝내 안 온 경우 */
export const canMarkAbsent = (r: AttendanceRecord) => r.status === "NO_CONTACT" || awaitingArrival(r);

/** 출결전화를 저장할 때 확정되는 최종 상태 */
export function finalStatus(c: CallState): AttStatus {
  if (c.arrived) return "PRESENT";
  if (isReached(c) && c.callResult === "LATE") return "LATE";
  if (isReached(c) && c.callResult === "ABSENT") return "ABSENT";
  if (c.kakao) return "NO_CONTACT";
  return "UNCHECKED";
}
