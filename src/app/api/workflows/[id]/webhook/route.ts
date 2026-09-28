import { ApiError, apiError, authenticate, json, requireId, sameOrigin } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken, hashToken, tokenHint, webhookUrl } from "@/lib/webhook";

/** Metadata browsers may see. The token hash is never selected. */
const ENDPOINT_METADATA = "id,workflow_id,token_hint,created_at,rotated_at,last_received_at,signing_hint,signing_created_at";

function appUrl(request: Request) {
  return process.env.APP_URL ?? new URL(request.url).origin;
}

async function ownWorkflow(id: string) {
  const { supabase, user } = await authenticate();
  const { data, error } = await supabase.from("workflows").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "errors.notFound");
  return { supabase, user };
}

export async function GET(request: Request, ctx: RouteContext<"/api/workflows/[id]/webhook">) {
  try {
    const id = requireId((await ctx.params).id);
    const { supabase, user } = await ownWorkflow(id);
    const { data, error } = await supabase.from("webhook_endpoints").select(ENDPOINT_METADATA).eq("workflow_id", id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return json({ endpoint: data, urlPrefix: webhookUrl("", appUrl(request)) });
  } catch (error) { return apiError(error); }
}

/** Creates the endpoint or rotates its token. The raw token is in this response only. */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[id]/webhook">) {
  try {
    sameOrigin(request);
    const id = requireId((await ctx.params).id);
    const { user } = await ownWorkflow(id);
    const token = generateToken();
    const admin = createAdminClient();
    const { data: existing } = await admin.from("webhook_endpoints").select("id").eq("workflow_id", id).eq("user_id", user.id).maybeSingle();
    const { data, error } = await admin.from("webhook_endpoints").upsert({
      workflow_id: id, user_id: user.id, token_hash: hashToken(token), token_hint: tokenHint(token),
      ...(existing ? { rotated_at: new Date().toISOString() } : {}),
    }, { onConflict: "workflow_id" }).select(ENDPOINT_METADATA).single();
    if (error) throw error;
    return json({ endpoint: data, token, url: webhookUrl(token, appUrl(request)) }, existing ? 200 : 201);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/workflows/[id]/webhook">) {
  try {
    sameOrigin(request);
    const id = requireId((await ctx.params).id);
    const { user } = await ownWorkflow(id);
    const { error } = await createAdminClient().from("webhook_endpoints").delete().eq("workflow_id", id).eq("user_id", user.id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
