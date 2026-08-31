import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import MakeupClient from "@/components/makeup/MakeupClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <MakeupClient user={user} />;
}
