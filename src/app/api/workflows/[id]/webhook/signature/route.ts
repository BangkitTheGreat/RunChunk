import { ApiError, apiError, authenticate, json, requireId, sameOrigin } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/vault";
import { generateSigningSecret, tokenHint } from "@/lib/webhook";

/** Metadata browsers may see; the encrypted secret never leaves the server. */
const ENDPOINT_METADATA = "id,workflow_id,token_hint,created_at,rotated_at,last_received_at,signing_hint,signing_created_at";

async function ownEndpoint(workflowId: string) {
  const { supabase, user } = await authenticate();
  const { data, error } = await supabase.from("webhook_endpoints").select("id").eq("workflow_id", workflowId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "errors.notFound");
  return { user, endpointId: data.id as string };
}

/** Enables signing or rotates the secret. The plaintext secret is in this response only. */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[id]/webhook/signature">) {
  try {
    sameOrigin(request);
    const workflowId = requireId((await ctx.params).id);
    const { user, endpointId } = await ownEndpoint(workflowId);
    const secret = generateSigningSecret();
    const sealed = encryptSecret({ type: "webhook_secret", value: secret }, user.id, endpointId, "webhook-signing");
    const { data, error } = await createAdminClient().from("webhook_endpoints").update({
      signing_ciphertext: sealed.ciphertext, signing_nonce: sealed.nonce, signing_tag: sealed.tag,
      signing_key_version: sealed.key_version, signing_hint: tokenHint(secret), signing_created_at: new Date().toISOString(),
    }).eq("id", endpointId).eq("user_id", user.id).select(ENDPOINT_METADATA).single();
    if (error) throw error;
    return json({ endpoint: data, secret });
  } catch (error) { return apiError(error); }
}

/** Turns signing off; unsigned requests are accepted again. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/workflows/[id]/webhook/signature">) {
  try {
    sameOrigin(request);
    const workflowId = requireId((await ctx.params).id);
    const { user, endpointId } = await ownEndpoint(workflowId);
    const { data, error } = await createAdminClient().from("webhook_endpoints").update({
      signing_ciphertext: null, signing_nonce: null, signing_tag: null, signing_key_version: null, signing_hint: null, signing_created_at: null,
    }).eq("id", endpointId).eq("user_id", user.id).select(ENDPOINT_METADATA).single();
    if (error) throw error;
    return json({ endpoint: data });
  } catch (error) { return apiError(error); }
}
