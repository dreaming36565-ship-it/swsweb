// 권한표 — 서버(API 검사)와 화면(버튼 보이기)이 같이 쓴다. DB 의존 금지.

import type { Role, SessionUser } from "./types";

/**
 * 기능별 허용 권한 — 새 기능을 추가할 때 여기에 함께 등록할 것.
 * 한 사람이 권한을 여러 개 가지면, 그중 하나라도 허용되면 할 수 있다.
 */
export const PERMISSIONS = {
  "timetable.read": ["ADMIN", "TEACHER", "DESK"],
  /** 전체 시간표 (요일별 · 선생님별 · 교실별 · 전체 반 · 학생 찾기) — 선생님은 내 시간표만 */
  "timetable.all": ["ADMIN", "DESK"],
  /** 반 관리(반 만들기·시간) · 강의실 · 명단 엑셀 올리기 · 반 삭제 */
  "timetable.write": ["ADMIN"],
  /** ⇄ 알파·수업 순서 바꾸기 */
  "timetable.swap": ["ADMIN"],
  /** 교실배정(빈 교실 찾기) · 사용 가능 교실 표시 */
  "rooms.booking": ["ADMIN", "DESK"],
  /** 교실 경고 「확인 완료」 */
  "rooms.alertOk": ["ADMIN"],
  /** 교재 책장 · 사용교재 입력 */
  "books.write": ["ADMIN", "TEACHER", "DESK"],
  /** 반 학생 명단 고치기 */
  "students.write": ["ADMIN", "TEACHER", "DESK"],
  "sr.read": ["ADMIN", "TEACHER", "DESK"],
  /** 자리 바로 바꾸기 · 선생님 요청 승인 */
  "sr.move": ["ADMIN", "DESK"],
  /** 자리 요청 보내기 (바로 바꿀 수 없는 선생님) */
  "sr.request": ["TEACHER"],
  /** 임시 자리 · 하원 · 미션지 받음/요청 */
  "sr.desk": ["ADMIN", "DESK"],
  /** 월초 자리 정리 */
  "sr.pack": ["ADMIN"],
  /** 🙋 SR 자리 요청 기록 지우기 (테스트 기록 정리) */
  "sr.purge": ["ADMIN"],
  "attendance.teacher": ["ADMIN", "TEACHER"],
  "attendance.desk": ["ADMIN", "DESK"],
  "attendance.read": ["ADMIN", "TEACHER", "DESK"],
  "makeups.read": ["ADMIN", "TEACHER", "DESK"],
  /** 결석 사유 · 알린 때 · 유료 보강 · 결석 미리 등록 */
  "absence.fix": ["ADMIN", "DESK"],
  /** 인정 / 개인사유 판정 · 이월 승인 */
  "absence.judge": ["ADMIN"],
  /** 숙제검사 기입 (선생님은 내 반만) */
  "homework.check": ["ADMIN", "TEACHER", "DESK"],
  /** 숙제반 관리 (요일 · 신청 등록 · 지각 숙제반) */
  "homework.class": ["ADMIN", "DESK"],
  /** 📷 숙제인증 확인 (선생님은 내 반만 — 미확인이면 담당T에게 알림) */
  "homework.cert": ["ADMIN", "TEACHER", "DESK"],
  "users.write": ["ADMIN"],
  "notices.write": ["ADMIN"],
  "tasks.write": ["ADMIN"],
  /** 🏫 학교 학사일정 고치기 (날짜 · 교과서) */
  "school.write": ["ADMIN", "TEACHER", "DESK"],
  /** 🗑 실수·테스트 기록 지우기 (각 화면 🗑 · 설정 › 기록 정리) */
  "records.purge": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(user: Pick<SessionUser, "roles">, perm: Permission): boolean {
  return user.roles.some((r) => (PERMISSIONS[perm] as readonly Role[]).includes(r));
}

/**
 * 📝 상담기록 — WRITE = 쓰기 · 전부 보기 (고등부 선생님 · 데스크 정직원 · 관리자)
 *              MIDDLE = 중등 학생 기록만 보기 (초중등부 선생님 — 고등부 선생님이 가르치는 중3 등)
 *              null = 메뉴 없음 (알바 데스크 등)
 */
export function counselAccess(user: Pick<SessionUser, "roles" | "department" | "partTime">): "WRITE" | "MIDDLE" | null {
  if (user.roles.includes("ADMIN")) return "WRITE";
  if (user.roles.includes("DESK") && !user.partTime) return "WRITE";
  if (user.roles.includes("TEACHER")) return user.department === "HIGH" ? "WRITE" : "MIDDLE";
  return null;
}

/**
 * 알바 근무 요일 제한 — 시간표 · SR 화면은 근무 요일만 (결석관리 등은 제한 없음).
 * 관리자이거나 정직원이면 null (제한 없음).
 */
export function dayLimit(user: Pick<SessionUser, "roles" | "partTime" | "workDays">): number[] | null {
  if (user.roles.includes("ADMIN") || !user.partTime) return null;
  return user.workDays;
}
