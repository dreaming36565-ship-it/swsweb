import { redirect } from "next/navigation";

/** 반 관리는 시간표 화면의 「반 관리」 탭으로 옮겼다 */
export default function Page() {
  redirect("/timetable?view=manage");
}
