import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SrClient from "@/components/sr/SrClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <SrClient user={user} />;
}
