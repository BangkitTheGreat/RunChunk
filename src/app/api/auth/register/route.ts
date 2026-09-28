import { apiError, json, readJson, sameOrigin } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readJson(request, 4096);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 || password.length < 8 || password.length > 255) {
      return json({ error: "auth.invalidCredentials" }, 400);
    }
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${new URL(request.url).origin}/auth/callback` },
    });
    if (error) return json({ error: "auth.errorGeneric" }, 400);
    return json({ confirmationRequired: !data.session }, 201);
  } catch (error) { return apiError(error); }
}
