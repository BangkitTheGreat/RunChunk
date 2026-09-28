import { ApiError, apiError, authenticate, json, requireId, sameOrigin } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { start } from "@/lib/executions/db";
import { validateDefinition } from "@/lib/workflow/validate";

/** Manual run from the editor. Works for every trigger type; the trigger node receives empty data. */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[id]/run">) {
  try {
    sameOrigin(request);
    const workflowId = requireId((await ctx.params).id);
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
    const result = await start(createAdminClient(), {
      workflowId, userId: user.id, definition, version: workflow.version, triggerSource: "manual", triggerData: {},
    });
    if (!result.ok && result.reason === "quota") return json({ error: "errors.quotaExceeded", used: result.used, quota: result.quota }, 403);
    if (!result.ok) return json({ error: "errors.dispatchFailed", executionId: result.executionId }, 502);
    return json({ executionId: result.executionId }, 202);
  } catch (error) { return apiError(error); }
}
