// DB 파일을 지운다. 다음 서버 실행 때 데모 데이터가 다시 생성된다.
// dev 서버를 끈 상태에서 실행할 것 (Windows가 DB 파일을 잠근다).
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let removed = 0;
for (const f of ["academy.db", "academy.db-journal", "academy.db-wal", "academy.db-shm"]) {
  const p = join(root, "data", f);
  if (existsSync(p)) {
    try {
      rmSync(p);
      removed++;
      console.log("삭제:", p);
    } catch (e) {
      console.error("삭제 실패:", p, "— dev 서버를 끄고 다시 실행하세요.");
      process.exit(1);
    }
  }
}
console.log(removed ? "DB를 초기화했습니다. 다음 실행 때 데모 데이터가 생성됩니다." : "지울 DB가 없습니다.");
