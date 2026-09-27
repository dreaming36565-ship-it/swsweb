// 공통 타입 — 서버/클라이언트 양쪽에서 import 가능해야 한다 (DB 의존 금지).

export type Role = "ADMIN" | "TEACHER" | "DESK";
export type Department = "ELEM" | "HIGH";
/** 수업 종류 — 보강은 여기 없다. 보강은 `보강 관리` 탭에서 따로 다룬다. */
export type SessionType = "COMMON" | "INDIVIDUAL" | "REGULAR" | "REVIEW" | "ALPHA";
/** 출결 단계 — 1차 출석체크 → 데스크 출결전화 → 끝 */
export type Stage = "CHECK" | "CALL" | "DONE";
/** 1차 출석체크를 누가 하는가 — 알파가 먼저 시작하면 데스크, 수업이 먼저면 담당 선생님 */
export type Checker = "TEACHER" | "DESK";
/** NO_CONTACT = 학생·학부모 모두 부재중이라 어머니께 카톡을 남긴 상태 */
export type AttStatus = "UNCHECKED" | "PRESENT" | "ABSENT" | "LATE" | "NO_CONTACT";
export type CallResult = "OK" | "MISS";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "관리자",
  TEACHER: "선생님",
  DESK: "데스크",
};

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  COMMON: "공통",
  INDIVIDUAL: "개별",
  REGULAR: "정규",
  REVIEW: "누적오답",
  ALPHA: "알파",
};

/** 보강 진행 상태 */
export type MakeupStatus = "PLANNED" | "DONE" | "CANCELED";

export const MAKEUP_STATUS_LABEL: Record<MakeupStatus, string> = {
  PLANNED: "예정",
  DONE: "완료",
  CANCELED: "취소",
};

export const STAGE_LABEL: Record<Stage, string> = {
  CHECK: "출석체크 대기",
  CALL: "출결전화 대기",
  DONE: "완료",
};

export const STATUS_LABEL: Record<AttStatus, string> = {
  UNCHECKED: "미체크",
  PRESENT: "출석",
  ABSENT: "결석",
  LATE: "지각",
  NO_CONTACT: "연락 안 됨",
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

/** 학생은 여러 반에 동시에 속할 수 있다 (정규반 + 개별반) */
export type Student = {
  id: number;
  name: string;
  department: Department;
  classIds: number[];
  classNames: string[];
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
  /** 1차 출석체크에서 "결석 연락 받음" 으로 처리했는가 */
  preNotified: 0 | 1;
  absentReason: string | null;
  lateReason: string | null;
  /** 도착예정시간 (분) */
  etaMin: number | null;
  /** 지각인데 학부모도 도착시간을 모름 */
  etaUnknown: 0 | 1;
  /** 결석으로 변경하기 전 상태 (연락 안 됨 / 도착시간 모르는 지각) — 되돌리기용 */
  absentFrom: AttStatus | null;
  studentCall: CallResult | null;
  studentCallAt: number | null;
  parentCall: CallResult | null;
  parentCallAt: number | null;
  kakaoAt: number | null;
  /** 통화가 된 뒤 고른 결과 (출결전화 중에만 쓰고, 저장하면 status 로 확정된다) */
  callResult: "LATE" | "ABSENT" | null;
  /** 도착 시각 (분) — 전화 중 도착, 또는 연락 안 됨이었다가 나중에 도착 */
  arrivedAt: number | null;
  /** 연락 안 됨이었다가 나중에 도착해 지각으로 옮겨졌는가 */
  lateArrival: 0 | 1;
};

export type AttendanceEvent = {
  id: number;
  sessionId: number;
  date: string;
  stage: Stage;
  checker: Checker;
  /** 출결이 시작된 시각(수업·알파 중 이른 쪽, 분) */
  triggerMin: number;
  classId: number;
  className: string;
  teacherId: number | null;
  teacherName: string | null;
  department: Department;
  roomName: string | null;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  alphaStartMin: number | null;
  alphaEndMin: number | null;
  records: AttendanceRecord[];
};

/** 같은 시각에 시작하는 반들을 묶은 팝업 한 장 */
export type AttendanceGroup = {
  key: string;
  kind: "CHECK" | "CALL";
  triggerMin: number;
  events: AttendanceEvent[];
};

/** 출결전화 팝업에서 학생 한 명의 전화 진행 상태 (누를 때마다 서버에 저장) */
export type CallState = {
  studentCall: CallResult | null;
  parentCall: CallResult | null;
  kakao: boolean;
  arrived: boolean;
  callResult: "LATE" | "ABSENT" | null;
  reason: string;
  etaMin: number | null;
  /** 도착시간 모름 — 시간이 없어도 지각으로 저장할 수 있다 */
  etaUnknown: boolean;
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

/** 보강 1건 — 정규 시간표와 별개로 특정 날짜에 잡힌다 */
export type Makeup = {
  id: number;
  studentId: number;
  studentName: string;
  classId: number | null;
  className: string | null;
  department: Department;
  /** 보강 사유가 된 결석 날짜 (직접 만든 보강이면 null) */
  absentDate: string | null;
  /** 보강을 진행하는 날짜 */
  date: string;
  startMin: number;
  endMin: number;
  roomId: number | null;
  roomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
  note: string | null;
  status: MakeupStatus;
  createdAt: string;
};

/** 보강이 필요한 결석 — 출결 기록에서 뽑는다. 횟수제 수강료라 빠짐없이 챙겨야 한다. */
export type PendingAbsence = {
  date: string;
  studentId: number;
  studentName: string;
  classId: number;
  className: string;
  department: Department;
  teacherId: number | null;
  teacherName: string | null;
  reason: string | null;
  /** 이미 잡힌 보강 */
  makeupId: number | null;
  makeupStatus: MakeupStatus | null;
  makeupDate: string | null;
};
