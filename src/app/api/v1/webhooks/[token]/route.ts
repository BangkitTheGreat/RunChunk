import { json } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { start } from "@/lib/executions/db";
import { validateDefinition } from "@/lib/workflow/validate";
import { MAX_WEBHOOK_BODY_BYTES, TOKEN_PATTERN, WEBHOOK_WINDOW_SECONDS, buildTriggerData, hashToken, parseWebhookBody } from "@/lib/webhook";

// Public, unauthenticated entry point. The token is the only credential, so every failure that could
// reveal whether a token exists returns the same 404. Same-origin checks do not apply: callers are
// external systems. Everything is read through the service role and scoped by the endpoint's owner.

const notFound = () => json({ error: "errors.notFound" }, 404);

async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_WEBHOOK_BODY_BYTES) throw new Error("errors.tooLarge");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      throw new Error("errors.tooLarge");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request, ctx: RouteContext<"/api/v1/webhooks/[token]">) {
  try {
    const { token } = await ctx.params;
    if (!TOKEN_PATTERN.test(token)) return notFound();
    const admin = createAdminClient();

    const { data: endpoint, error: endpointError } = await admin.from("webhook_endpoints")
      .select("id,workflow_id,user_id").eq("token_hash", hashToken(token)).maybeSingle();
    if (endpointError) throw endpointError;
    if (!endpoint) return notFound();
    const { data: workflow, error: workflowError } = await admin.from("workflows")
      .select("definition,version,is_active").eq("id", endpoint.workflow_id).eq("user_id", endpoint.user_id).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow || !workflow.is_active) return notFound();

    // Rate limit per endpoint, stored in the database so every instance shares the same window.
    const { data: profile } = await admin.from("profiles").select("plan").eq("id", endpoint.user_id).maybeSingle();
    const { data: limits } = await admin.rpc("plan_limits", { p_plan: profile?.plan ?? "free" }).single();
    const perMinute = (limits as { webhook_per_minute?: number } | null)?.webhook_per_minute ?? 10;
    const { data: hit, error: hitError } = await admin.rpc("webhook_hit", {
      p_endpoint_id: endpoint.id, p_limit: perMinute, p_window_seconds: WEBHOOK_WINDOW_SECONDS,
    }).single();
    if (hitError) throw hitError;
    const verdict = hit as { allowed: boolean; retry_after: number };
    if (!verdict.allowed) {
      return new Response(JSON.stringify({ error: "errors.rateLimited" }), {
        status: 429, headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": String(verdict.retry_after) },
      });
    }

    let body: unknown;
    try {
      body = parseWebhookBody(request.headers.get("content-type"), await readBody(request));
    } catch (error) {
      const key = error instanceof Error ? error.message : "errors.invalidInput";
      return json({ error: key }, key === "errors.tooLarge" ? 413 : 400);
    }

    let definition;
    try {
      definition = validateDefinition(workflow.definition);
    } catch {
      return json({ error: "errors.invalidWorkflow" }, 422);
    }
    const receivedAt = new Date();
    const result = await start(admin, {
      workflowId: endpoint.workflow_id, userId: endpoint.user_id, definition, version: workflow.version,
      triggerSource: "webhook", triggerData: buildTriggerData(request, body, receivedAt),
    });
    await admin.from("webhook_endpoints").update({ last_received_at: receivedAt.toISOString() }).eq("id", endpoint.id);
    if (!result.ok && result.reason === "quota") return json({ error: "errors.quotaExceeded" }, 403);
    if (!result.ok) return json({ error: "errors.dispatchFailed", executionId: result.executionId }, 502);
    return json({ executionId: result.executionId }, 202);
  } catch (error) {
    console.error("webhook error", { type: error instanceof Error ? error.name : "unknown" });
    return json({ error: "errors.server" }, 500);
  }
}

export function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
