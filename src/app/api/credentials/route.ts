import { randomUUID } from "node:crypto";
import { apiError, authenticate, json, readJson, sameOrigin } from "@/lib/api";
import { CREDENTIAL_METADATA, credentialName, parseSecret } from "@/lib/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/vault";

export async function GET() {
  try {
    const { supabase, user } = await authenticate();
    // User-scoped client: RLS + column grants make ciphertext unreadable here even by mistake.
    const { data, error } = await supabase.from("credentials").select(CREDENTIAL_METADATA).eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return json({ credentials: data });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { user } = await authenticate();
    const body = await readJson(request, 16_000);
    const name = credentialName(body.name);
    const { secret, headerName } = parseSecret(body);
    const id = randomUUID();
    const encrypted = encryptSecret(secret, user.id, id);
    const { data, error } = await createAdminClient().from("credentials")
      .insert({ id, user_id: user.id, name, type: secret.type, header_name: headerName, ...encrypted })
      .select(CREDENTIAL_METADATA).single();
    if (error) throw error;
    return json({ credential: data }, 201);
  } catch (error) { return apiError(error); }
}
