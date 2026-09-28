import { apiError, authenticate, json, readJson, requireId, sameOrigin, workflowName, ApiError } from "@/lib/api";
import { validateDefinition } from "@/lib/workflow/validate";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSchedule } from "@/lib/executions/db";

const WORKFLOW_FIELDS = "id,name,definition,version,is_active,route_color,created_at,updated_at";

export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  try {
    const id = requireId((await ctx.params).id);
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflows").select(WORKFLOW_FIELDS).eq("id", id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "errors.notFound");
    return json({ workflow: data });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  try {
    sameOrigin(request);
    const id = requireId((await ctx.params).id);
    const { supabase, user } = await authenticate();
    const body = await readJson(request);
    const name = workflowName(body.name);
    const definition = validateDefinition(body.definition);
    const routeColor = Number(body.routeColor);
    const query = supabase.from("workflows").update({
      name, definition, ...(Number.isInteger(routeColor) && routeColor >= 1 && routeColor <= 6 ? { route_color: routeColor } : {}),
    }).eq("id", id).eq("user_id", user.id);
    if (typeof body.expectedVersion === "number") query.eq("version", body.expectedVersion);
    const { data, error } = await query.select(WORKFLOW_FIELDS).maybeSingle();
    if (error) throw error;
    if (!data) {
      const { count } = await supabase.from("workflows").select("*", { count: "exact", head: true }).eq("id", id).eq("user_id", user.id);
      if (count && count > 0) throw new ApiError(409, "errors.conflict");
      throw new ApiError(404, "errors.notFound");
    }
    // Keep the schedule mirror current so an active workflow picks up an edited cron on its next slot.
    if (data.is_active) await syncSchedule(createAdminClient(), { id, user_id: user.id, definition });
    return json({ workflow: data });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  try {
    sameOrigin(request);
    const id = requireId((await ctx.params).id);
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflows").delete().eq("id", id).eq("user_id", user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "errors.notFound");
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
