// 📝 상담기록 항목 — 서버 · 화면 공용 (순수). 2026-10-02 사용자 확정.

export const COUNSEL_KIND = ["원생", "신규상담", "퇴원상담"] as const;
export const COUNSEL_HOW = ["전화걸어서", "전화받음", "방문", "카톡/문자"] as const;
export const COUNSEL_TARGET = ["어머니", "아버지", "학생", "기타"] as const;
export const COUNSEL_TOPIC = ["학교성적", "학습태도", "진로/입시", "출결", "수강/반이동", "기타"] as const;
export const COUNSEL_ROLE = ["과목교사", "담임", "원장"] as const;

/** 등록 창을 열면 미리 골라 두는 값 */
export const COUNSEL_DEFAULT = { kind: "원생", how: "전화걸어서", target: "어머니", role: "과목교사" } as const;
