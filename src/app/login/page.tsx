import { isSupabaseConfigured } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { getTranslations } from "next-intl/server";

export default async function LoginPage() {
  const t = await getTranslations("auth");
  if (!isSupabaseConfigured()) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
        <h1 className="mb-4 text-3xl font-bold">{t("setupTitle")}</h1>
        <p className="max-w-xl text-lg font-medium">
          {t("setupDesc")}
        </p>
      </main>
    );
  }
  return <LoginForm />;
}
