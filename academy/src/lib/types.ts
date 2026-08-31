// 공통 타입 — 서버/클라이언트 양쪽에서 import 가능해야 한다 (DB 의존 금지).

export type Role = "ADMIN" | "TEACHER" | "DESK";
export type Department = "ELEM" | "HIGH";
export type SessionType = "REGULAR" | "MAKEUP" | "ALPHA" | "COUNSEL" | "EXAM";
export type Stage = "TEACHER_PENDING" | "DESK_PENDING" | "TEACHER_CONFIRM" | "DONE";
export type AttStatus = "UNCHECKED" | "PRESENT" | "ABSENT" | "LATE";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "관리자",
  TEACHER: "선생님",
  DESK: "데스크",
};

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  REGULAR: "정규수업",
  MAKEUP: "보강",
  ALPHA: "알파",
  COUNSEL: "상담",
  EXAM: "시험",
};

export const STAGE_LABEL: Record<Stage, string> = {
  TEACHER_PENDING: "출석체크 대기",
  DESK_PENDING: "출결전화 대기",
  TEACHER_CONFIRM: "최종확인 대기",
  DONE: "완료",
};

export const STATUS_LABEL: Record<AttStatus, string> = {
  UNCHECKED: "미체크",
  PRESENT: "출석",
  ABSENT: "결석",
  LATE: "지각",
};

export type Brand = {
  key: Department;
  /** 부서명 */
  dept: string;
  /** 브랜드 표기 */
  brand: string;
  /** 지점명 — 상단바/사이드바에 노출 */
  branch: string;
  logo: string;
};

export const DEPARTMENTS: Record<Department, Brand> = {
  ELEM: {
    key: "ELEM",
    dept: "초중등부",
    brand: "U2M 유투엠",
    branch: "유투엠 분당서현",
    logo: "/logos/u2m.png",
  },
  HIGH: {
    key: "HIGH",
    dept: "고등부",
    brand: "STUDYKILLER",
    branch: "스터디킬러 분당서현",
    logo: "/logos/studykiller.png",
  },
};

export type SessionUser = {
  id: number;
  loginId: string;
  name: string;
  role: Role;
  department: Department;
};

export type Room = { id: number; name: string; orderNo: number; isSr: 0 | 1 };

export type ClassRow = {
  id: number;
  name: string;
  department: Department;
  teacherId: number | null;
  teacherName: string | null;
  roomId: number | null;
  roomName: string | null;
  grade: string | null;
  textbook: string | null;
  studentCount: number;
};

export type Student = {
  id: number;
  name: string;
  department: Department;
  classId: number | null;
  className: string | null;
  active: 0 | 1;
};

export type TimetableSession = {
  id: number;
  dayOfWeek: number;
  classId: number;
  className: string;
  department: Department;
  type: SessionType;
  startMin: number;
  endMin: number;
  alphaStartMin: number | null;
  alphaEndMin: number | null;
  roomId: number | null;
  roomName: string | null;
  alphaRoomId: number | null;
  alphaRoomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
  studentCount: number;
};

export type SrAssignment = {
  id: number;
  sessionId: number;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
  dayOfWeek: number;
  seat: string;
  startMin: number;
  endMin: number;
  isManual: 0 | 1;
};

export type AttendanceRecord = {
  id: number;
  studentId: number;
  studentName: string;
  status: AttStatus;
  absentReason: string | null;
  lateReason: string | null;
  eta: string | null;
};

export type AttendanceEvent = {
  id: number;
  sessionId: number;
  date: string;
  stage: Stage;
  className: string;
  teacherId: number | null;
  teacherName: string | null;
  department: Department;
  roomName: string | null;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  records: AttendanceRecord[];
};

export type Notification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type Task = {
  id: number;
  assigneeId: number;
  assigneeName: string;
  createdBy: number;
  createdByName: string;
  title: string;
  done: 0 | 1;
  dueDate: string | null;
  createdAt: string;
};

export type Notice = {
  id: number;
  title: string;
  body: string;
  department: Department | "ALL";
  authorId: number | null;
  authorName: string | null;
  createdAt: string;
};

export type Conflict = {
  kind: "ROOM" | "TEACHER" | "STUDENT" | "SR_CAPACITY";
  message: string;
  sessionIds: number[];
};

/** 직원 계정 (클라이언트에서도 쓰는 형태) */
export type StaffUser = {
  id: number;
  loginId: string;
  name: string;
  role: Role;
  department: Department;
  active: 0 | 1;
};
