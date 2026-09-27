import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { withUser } from "@/lib/api";
import { listClasses, listRooms, listSessions, listStudents, listUsers } from "@/lib/repo";

/** 이 컴퓨터에만 있는 시안용 숙제 기록 (data/homework.local.json, git 제외) — 없으면 빈 값 */
function localHomework(): { marks: unknown[]; late: unknown[] } {
  const file = path.join(process.cwd(), "data", "homework.local.json");
  if (!existsSync(file)) return { marks: [], late: [] };
  const json = JSON.parse(readFileSync(file, "utf8")) as { marks?: unknown[]; late?: unknown[] };
  return { marks: json.marks ?? [], late: json.late ?? [] };
}

/**
 * 시안(public/mockups) 화면이 쓰는 데이터 — 로그인한 직원에게만 내려준다.
 * 실제 학생 이름이 들어 있으므로 파일(data.json)로 두지 않고 여기서만 꺼내 준다.
 */
export const GET = withUser(({ user }) => {
  const users = listUsers();
  const sessions = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => listSessions(d, "ALL"));
  return {
    me: { name: user.name, role: user.role },
    classes: listClasses("ALL"),
    students: listStudents("ALL"),
    rooms: listRooms(),
    teachers: users
      .filter((u) => u.role !== "DESK" && u.active === 1)
      .map((u) => ({ id: u.id, name: u.name, role: u.role, department: u.department })),
    staff: users.filter((u) => u.active === 1).map((u) => ({ name: u.name, role: u.role })),
    sessions,
    homework: localHomework(),
  };
});
