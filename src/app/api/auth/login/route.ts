import { apiError, json, readJson, sameOrigin } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readJson(request, 4096);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || email.length > 255 || password.length > 255) {
      return json({ error: "auth.errorGeneric" }, 400);
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      return json({ error: "auth.errorGeneric" }, 401);
    }
    return json({ user: { id: data.user.id, email: data.user.email } });
  } catch (error) {
    return apiError(error);
  }
}
