import { readJson, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { saveSchoolBook, saveSchoolCell, schoolData } from "@/lib/repo";
import type { SchoolRange } from "@/lib/school";

/** 🏫 학교 학사일정 — 보기는 로그인한 직원 모두, 고치기 = 선생님 · 데스크 · 관리자 */
export const GET = withUser(() => schoolData());

type Body =
  | { action: "CELL"; schoolId: number; kind: string; ranges: SchoolRange[]; none?: boolean; append?: boolean }
  | { action: "BOOK"; schoolId: number; subject: string; publisher: string };

export const POST = withUser(async ({ user, req }) => {
  const b = await readJson<Body>(req);
  switch (b.action) {
    case "CELL":
      saveSchoolCell(user, b);
      return null;
    case "BOOK":
      saveSchoolBook(user, b.schoolId, b.subject, b.publisher);
      return null;
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
});
