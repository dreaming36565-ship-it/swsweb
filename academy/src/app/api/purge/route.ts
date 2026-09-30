import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { purgeDelete, purgeDescribe, purgeFind, type PurgeKey, type PurgeRange } from "@/lib/repo";

/**
 * 🗑 실수·테스트 기록 지우기 (관리자)
 * - FIND: 학생 이름 + 기간으로 기능별 기록 찾기 (설정 › 기록 정리)
 * - DESCRIBE: 🗑 확인창에 보여 줄 「같이 지워지는 것」
 * - DELETE: 고른 기록을 한 번에 지우기
 */
type Body =
  | { action: "FIND"; name: string; range: PurgeRange }
  | { action: "DESCRIBE"; items: PurgeKey[] }
  | { action: "DELETE"; items: PurgeKey[] };

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "records.purge");
  const b = await readJson<Body>(req);
  switch (b.action) {
    case "FIND":
      return { items: purgeFind(user, b.name ?? "", ["TODAY", "WEEK", "MONTH", "ALL"].includes(b.range) ? b.range : "MONTH") };
    case "DESCRIBE":
      return { items: purgeDescribe(user, b.items ?? []) };
    case "DELETE":
      return { deleted: purgeDelete(user, b.items ?? []) };
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
});
