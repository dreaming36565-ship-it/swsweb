import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SettingsClient from "@/components/settings/SettingsClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <SettingsClient user={user} />;
}
