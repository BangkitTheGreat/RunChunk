import { ApiError, apiError, authenticate, json, readJson, requireId, sameOrigin } from "@/lib/api";
import { CREDENTIAL_METADATA, credentialName, parseSecret } from "@/lib/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/vault";

/** Replace a credential's secret (and name) in place, so workflows referencing its ID keep working. */
export async function PUT(request: Request, ctx: RouteContext<"/api/credentials/[id]">) {
  try {
    sameOrigin(request);
    // Canonical ID: it is part of the Vault AAD and must match the lowercase UUID Postgres returns.
    const id = requireId((await ctx.params).id);
    const { user } = await authenticate();
    const body = await readJson(request, 16_000);
    const name = credentialName(body.name);
    const { secret, headerName } = parseSecret(body);
    const encrypted = encryptSecret(secret, user.id, id);
    const { data, error } = await createAdminClient().from("credentials")
      .update({ name, type: secret.type, header_name: headerName, ...encrypted })
      .eq("id", id).eq("user_id", user.id)
      .select(CREDENTIAL_METADATA).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "errors.notFound");
    return json({ credential: data });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/credentials/[id]">) {
  try {
    sameOrigin(request);
    const id = requireId((await ctx.params).id);
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("credentials").delete().eq("id", id).eq("user_id", user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "errors.notFound");
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
