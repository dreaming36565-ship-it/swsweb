import { numParam, readJson, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { counselData, counselsOfStudent, deleteCounsel, saveCounsel, type CounselInput } from "@/lib/repo";

/**
 * 📝 상담기록 — ?from=&to= 기간 (강사별) · ?student= 학생별.
 * 고등부 선생님 · 데스크(정직원) · 관리자 = 전부 / 초중등부 선생님 = 중등 학생 기록만 (서버에서 거름).
 */
export const GET = withUser(({ user, req }) => {
  const student = numParam(req, "student");
  if (student) return { records: counselsOfStudent(user, student) };
  const from = strParam(req, "from") ?? "0000-00-00";
  const to = strParam(req, "to") ?? "9999-12-31";
  return counselData(user, from, to);
});

type Body = ({ action: "SAVE" } & CounselInput) | { action: "DELETE"; id: number };

export const POST = withUser(async ({ user, req }) => {
  const b = await readJson<Body>(req);
  switch (b.action) {
    case "SAVE":
      return { id: saveCounsel(user, b) };
    case "DELETE":
      deleteCounsel(user, b.id);
      return null;
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
});
