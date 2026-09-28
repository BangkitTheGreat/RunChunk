import { ApiError, apiError, authenticate, json, readJson, requireId, sameOrigin } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSchedule } from "@/lib/executions/db";
import { validateDefinition } from "@/lib/workflow/validate";

const WORKFLOW_FIELDS = "id,name,definition,version,is_active,route_color,created_at,updated_at";

function versionNumber(raw: string): number {
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) throw new ApiError(400, "errors.invalidInput");
  return version;
}

/** One saved version with its full definition. */
export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]/versions/[version]">) {
  try {
    const params = await ctx.params;
    const id = requireId(params.id);
    const version = versionNumber(params.version);
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflow_versions")
      .select("version,name,definition,route_color,created_at")
      .eq("workflow_id", id).eq("user_id", user.id).eq("version", version).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "errors.notFound");
    return json({ version: data });
  } catch (error) { return apiError(error); }
}

/**
 * Restore: copies the saved name/definition onto the workflow as a NEW version (the trigger records it),
 * so a restore can itself be undone. Body: { expectedVersion } guards against clobbering unseen edits.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[id]/versions/[version]">) {
  try {
    sameOrigin(request);
    const params = await ctx.params;
    const id = requireId(params.id);
    const version = versionNumber(params.version);
    const { supabase, user } = await authenticate();
    const body = await readJson(request, 1024);
    const { data: saved, error: loadError } = await supabase.from("workflow_versions")
      .select("name,definition").eq("workflow_id", id).eq("user_id", user.id).eq("version", version).maybeSingle();
    if (loadError) throw loadError;
    if (!saved) throw new ApiError(404, "errors.notFound");
    const definition = validateDefinition(saved.definition);
    const query = supabase.from("workflows").update({ name: saved.name, definition }).eq("id", id).eq("user_id", user.id);
    if (typeof body.expectedVersion === "number") query.eq("version", body.expectedVersion);
    const { data, error } = await query.select(WORKFLOW_FIELDS).maybeSingle();
    if (error) throw error;
    if (!data) {
      const { count } = await supabase.from("workflows").select("*", { count: "exact", head: true }).eq("id", id).eq("user_id", user.id);
      if (count && count > 0) throw new ApiError(409, "errors.conflict");
      throw new ApiError(404, "errors.notFound");
    }
    if (data.is_active) await syncSchedule(createAdminClient(), { id, user_id: user.id, definition });
    return json({ workflow: data });
  } catch (error) { return apiError(error); }
}
