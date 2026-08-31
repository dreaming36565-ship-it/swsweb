import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return <LoginForm />;
}
