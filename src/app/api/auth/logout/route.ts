import { apiError, json, sameOrigin } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const supabase = await createClient();
    await supabase.auth.signOut();
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
