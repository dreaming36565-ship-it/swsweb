// ★ 서버 전용. 클라이언트 컴포넌트에서 import 금지.
// 모든 DB 접근은 lib/repo/ 폴더(주제별 파일)에서만 한다. 여기서 한데 모아 내보낸다.

export * from "./repo/base";
export * from "./repo/staff";
export * from "./repo/timetable";
export * from "./repo/sr";
export * from "./repo/attendance";
export * from "./repo/absence";
export * from "./repo/homework";
export * from "./repo/misc";
export * from "./repo/purge";
export * from "./repo/school";
export * from "./repo/counsel";
export * from "./repo/examdocs";
