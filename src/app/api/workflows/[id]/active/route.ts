import { ApiError, apiError, authenticate, json, readJson, requireId, sameOrigin } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSchedule } from "@/lib/executions/db";
import { scheduleConfig, triggerNode, validateDefinition } from "@/lib/workflow/validate";

const WORKFLOW_FIELDS = "id,name,definition,version,is_active,route_color,created_at,updated_at";

/**
 * Turns a webhook/schedule workflow on or off. Activation counts against the plan's active-workflow limit
 * (checked atomically in set_workflow_active) and requires a runnable definition.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/workflows/[id]/active">) {
  try {
    sameOrigin(request);
    const id = requireId((await ctx.params).id);
    const { supabase, user } = await authenticate();
    const body = await readJson(request, 1024);
    if (typeof body.active !== "boolean") throw new ApiError(400, "errors.invalidInput");

    const { data: workflow, error } = await supabase.from("workflows").select(WORKFLOW_FIELDS).eq("id", id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!workflow) throw new ApiError(404, "errors.notFound");

    const admin = createAdminClient();
    if (body.active) {
      const definition = validateDefinition(workflow.definition);
      const trigger = triggerNode(definition);
      if (trigger.type === "trigger.manual") throw new ApiError(400, "errors.activationNotNeeded");
      if (trigger.type === "trigger.schedule" && !scheduleConfig(definition)) throw new ApiError(400, "errors.scheduleInvalid");
      const { data, error: rpcError } = await admin.rpc("set_workflow_active", { p_workflow_id: id, p_user_id: user.id, p_active: true }).single();
      if (rpcError) throw rpcError;
      const verdict = data as { ok: boolean; active_count: number; active_limit: number };
      if (!verdict.ok) return json({ error: "errors.activeLimitReached", activeCount: verdict.active_count, activeLimit: verdict.active_limit }, 403);
      await syncSchedule(admin, { id, user_id: user.id, definition });
    } else {
      const { error: rpcError } = await admin.rpc("set_workflow_active", { p_workflow_id: id, p_user_id: user.id, p_active: false });
      if (rpcError) throw rpcError;
    }
    const { data: updated, error: reloadError } = await supabase.from("workflows").select(WORKFLOW_FIELDS).eq("id", id).eq("user_id", user.id).single();
    if (reloadError) throw reloadError;
    return json({ workflow: updated });
  } catch (error) { return apiError(error); }
}
