import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SchoolClient from "@/components/school/SchoolClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <SchoolClient user={user} />;
}
