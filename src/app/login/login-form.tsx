"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

export function LoginForm() {
  const t = useTranslations("auth");
  const common = useTranslations("common");

  const router = useRouter();
  const search = useSearchParams();
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) setError(result.error ?? "auth.errorGeneric");
      else if (register && result.confirmationRequired) setError("auth.confirmationRequired");
      else router.replace("/");
    } catch {
      setError("auth.errorGeneric");
    } finally {
      setBusy(false);
    }
  }

  const displayedError = search.has("error") ? "errorGeneric" : error.startsWith("auth.") ? error.slice(5) : error;
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">RunChunk</p>
        <h1 className="mt-3 text-3xl font-semibold">{t("title")}</h1>
        <label className="mt-8 block text-sm font-medium" htmlFor="email">{t("emailLabel")}</label>
        <input id="email" name="email" type="email" autoComplete="email" required maxLength={255} className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3" />
        <label className="mt-5 block text-sm font-medium" htmlFor="password">{t("passwordLabel")}</label>
        <input id="password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} maxLength={255} className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3" />
        {displayedError && <p role="alert" className="mt-4 text-sm text-danger">{displayedError.startsWith("errors.") ? displayedError : t(displayedError)}</p>}
        <button disabled={busy} className="mt-6 w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? common("loading") : register ? t("submitRegister") : t("submitLogin")}</button>
        <button type="button" onClick={() => { setRegister(!register); setError(""); }} className="mt-5 w-full text-sm text-accent underline underline-offset-4">{register ? t("switchToLogin") : t("switchToRegister")}</button>
      </form>
    </main>
  );
}
