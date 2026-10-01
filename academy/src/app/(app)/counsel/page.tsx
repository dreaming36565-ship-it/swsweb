import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { counselAccess } from "@/lib/perm";
import CounselClient from "@/components/counsel/CounselClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // 알바 데스크 등은 메뉴도 없고 주소로 들어와도 막는다
  if (!counselAccess(user)) redirect("/dashboard");
  return <CounselClient user={user} />;
}
