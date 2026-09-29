// 공통 타입 — 서버/클라이언트 양쪽에서 import 가능해야 한다 (DB 의존 금지).

export type Role = "ADMIN" | "TEACHER" | "DESK";
export const ROLES: Role[] = ["ADMIN", "TEACHER", "DESK"];
export type Department = "ELEM" | "HIGH";
/** 수업 종류 — 보강은 여기 없다. HOMEWORK = 숙제반(수업 없이 SR만) */
export type SessionType = "COMMON" | "INDIVIDUAL" | "REGULAR" | "REVIEW" | "ALPHA" | "HOMEWORK";
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

/** "관리자 + 선생님" */
export const rolesLabel = (roles: Role[]) =>
  ROLES.filter((r) => roles.includes(r))
    .map((r) => ROLE_LABEL[r])
    .join(" + ");

export const hasRole = (u: { roles: Role[] } | null | undefined, r: Role) => !!u && u.roles.includes(r);

/** 선생님은 「이름T」 로 줄여 쓴다. 담당이 없으면 「미정」 */
export const teacherLabel = (name: string | null | undefined) => (name ? `${name}T` : "미정");

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  COMMON: "공통",
  INDIVIDUAL: "개별",
  REGULAR: "정규",
  REVIEW: "누적오답",
  ALPHA: "알파",
  HOMEWORK: "숙제반",
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
  /** 권한 여러 개 — 할 수 있는 일은 권한들을 합친 것 */
  roles: Role[];
  department: Department;
  /** 처음 비밀번호로 로그인했으면 새 비밀번호를 정해야 한다 */
  mustChangePw: boolean;
};

export type Room = { id: number; name: string; orderNo: number; isSr: 0 | 1; capacity: number | null };

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
  /** 직접 입력한 학년의 학교급 (초등·중등·고등) */
  level: string | null;
  studentCount: number;
  /** 🔗 합반 — 같은 교실 · 같은 선생님과 같이 수업하는 반 */
  hapbanWith: number | null;
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
  /** 수업 칸 이름 (수업 · 개별 · TEST …) */
  label: string | null;
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
  /** 이 날짜만 수업·알파 순서를 바꿨는가 (⇄ 이번 주만) */
  swapped?: boolean;
};

/* ------------------------------------------------------------ 시간표 (반 + 칸) */

/** 반의 칸 — 수업 칸(CLASS) 또는 SR 칸. 칸마다 요일이 다를 수 있다 */
export type ClassPart = {
  kind: "CLASS" | "SR";
  label: string;
  start: number;
  end: number;
  roomId: number | null;
  roomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
  days: number[];
  bookIds: number[];
};

/** 시간표 화면이 쓰는 반 한 개 */
export type ClassModel = {
  id: number;
  name: string;
  department: Department;
  type: SessionType;
  grade: string | null;
  level: string | null;
  textbook: string | null;
  /** 담임(담당) 선생님 */
  teacherId: number | null;
  teacherName: string | null;
  students: { id: number; name: string }[];
  days: number[];
  parts: ClassPart[];
  /** 수업 없이 SR만 쓰는 반 (누적오답 · 숙제반) */
  srOnly: boolean;
  /** 🔗 합반 — 같은 교실 · 같은 선생님과 같이 수업하는 반 (겹침 경고 없음, 출결·SR은 각자 시간) */
  hapbanWith: number | null;
};

export type Book = { id: number; level: string; grade: string; name: string; createdAt: string };

/** 교실배정 · 사용 표시 (그 날짜 하루만) */
export type RoomBooking = {
  id: number;
  date: string;
  roomId: number;
  roomName: string;
  start: number;
  end: number;
  name: string;
  headcount: number | null;
  teacherId: number | null;
  teacherName: string | null;
};

/** 이번 주 그날만 순서를 바꾼 반 */
export type TempSwap = { classId: number; day: number; date: string; sessionId: number };

/* ------------------------------------------------------------------ 출결 */

export type AttendanceRecord = {
  id: number;
  studentId: number;
  studentName: string;
  status: AttStatus;
  /** 1차 출석체크에서 "결석 연락 받음" 으로 처리했는가 */
  preNotified: 0 | 1;
  absentReason: string | null;
  /** 결석 사유 빠른 선택으로 고른 구분 */
  absentCat: AbsenceCat | null;
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
  /** 결석 보강이 끝났으면 그 날짜 (결석관리 "9/23 보강완료") */
  makeupDoneDate?: string | null;
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
  /** 결석 사유 빠른 선택의 구분 */
  absentCat: AbsenceCat | null;
  etaMin: number | null;
  /** 도착시간 모름 — 시간이 없어도 지각으로 저장할 수 있다 */
  etaUnknown: boolean;
};

/* ------------------------------------------------------------------- SR */

/** 📄 미션지 요청 — 담당 선생님 화면에 팝업 */
export type MissionRequest = {
  classId: number;
  className: string;
  date: string;
  start: number;
  end: number;
  requestedAt: number;
};

/* ---------------------------------------------------------------- 결석보강 */

/** 결석 구분 — OK 인정 / PERSONAL 개인사유 */
export type AbsenceCat = "OK" | "PERSONAL";
/** 알린 때 — PRE 미리 / SAME_DAY 당일 / NONE 무연락 */
export type AbsenceNotice = "PRE" | "SAME_DAY" | "NONE";
export type RoundType = "MAKEUP" | "TASK";
export type RoundState = "PLANNED" | "DONE" | "MISSED";

export type AbsenceRound = {
  id: number;
  type: RoundType;
  date: string | null;
  startMin: number | null;
  state: RoundState;
};

export type Absence = {
  id: number;
  studentId: number | null;
  studentName: string;
  classId: number | null;
  className: string;
  teacherId: number | null;
  teacherName: string | null;
  department: Department;
  date: string;
  reason: string;
  cat: AbsenceCat | null;
  notice: AbsenceNotice | null;
  paid: boolean;
  more: boolean;
  dream: boolean;
  memo: string;
  source: string;
  carryReq: { reason: string; by: string; at: string } | null;
  carried: { reason: string; by: string; approvedBy: string; at: string } | null;
  rejected: { by: string; note: string } | null;
  rounds: AbsenceRound[];
  log: { text: string; at: string }[];
};

/* ---------------------------------------------------------------- 알림 등 */

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
  roles: Role[];
  department: Department;
  active: 0 | 1;
};
