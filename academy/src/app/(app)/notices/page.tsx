import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import NoticesClient from "@/components/NoticesClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <NoticesClient user={user} />;
}
