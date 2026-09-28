import { randomUUID } from "node:crypto";
import { ApiError, apiError, authenticate, json, requireId, sameOrigin } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import { validateDefinition } from "@/lib/workflow/validate";

export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[id]/run">) {
  try {
    sameOrigin(request);
    const { id: workflowId } = await ctx.params;
    requireId(workflowId);
    const { supabase, user } = await authenticate();

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id,definition,version")
      .eq("id", workflowId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) throw new ApiError(404, "errors.notFound");

    const definition = validateDefinition(workflow.definition);

    const admin = createAdminClient();
    const executionId = randomUUID();
    const { error: insertError } = await admin.from("executions").insert({
      id: executionId,
      workflow_id: workflowId,
      user_id: user.id,
      definition_snapshot: definition,
      definition_version: workflow.version,
      trigger_data: {},
      status: "pending",
    });
    if (insertError) throw insertError;

    try {
      await inngest.send({
        name: "runchunk/workflow.run",
        data: { executionId, userId: user.id, workflowId, triggerData: {} },
      });
    } catch (dispatchError) {
      console.error("inngest dispatch failed", { type: dispatchError instanceof Error ? dispatchError.name : "unknown" });
      const { error: markError } = await admin
        .from("executions")
        .update({ status: "dispatch_failed", error: "errors.dispatchFailed", finished_at: new Date().toISOString() })
        .eq("id", executionId)
        .eq("user_id", user.id)
        .eq("workflow_id", workflowId)
        .eq("status", "pending");
      if (markError) console.error("dispatch_failed mark failed", { code: markError.code });
      return json({ error: "errors.dispatchFailed", executionId }, 502);
    }

    return json({ executionId }, 202);
  } catch (error) { return apiError(error); }
}
