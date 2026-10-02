import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { examDocsAccess } from "@/lib/perm";
import ExamDocsClient from "@/components/examdocs/ExamDocsClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // 관리자가 고른 직원만 (알바 제외) — 주소로 들어와도 막는다
  const access = examDocsAccess(user);
  if (!access) redirect("/dashboard");
  return <ExamDocsClient user={user} admin={access === "ADMIN"} />;
}
