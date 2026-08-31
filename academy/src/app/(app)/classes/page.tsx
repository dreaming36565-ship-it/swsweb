import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import ClassesClient from "@/components/classes/ClassesClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <ClassesClient user={user} />;
}
