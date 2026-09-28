import { apiError, authenticate, json, readJson, requireId, sameOrigin, workflowName, ApiError } from "@/lib/api";
import { validateDefinition } from "@/lib/workflow/validate";

export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  try {
    const { id } = await ctx.params;
    requireId(id);
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflows").select("id,name,definition,version,created_at,updated_at").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "errors.notFound");
    return json({ workflow: data });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  try {
    sameOrigin(request);
    const { id } = await ctx.params;
    requireId(id);
    const { supabase, user } = await authenticate();
    const body = await readJson(request);
    const name = workflowName(body.name);
    const definition = validateDefinition(body.definition);
    const query = supabase.from("workflows").update({ name, definition }).eq("id", id).eq("user_id", user.id);
    if (typeof body.expectedVersion === "number") query.eq("version", body.expectedVersion);
    const { data, error } = await query.select("id,name,definition,version,created_at,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) {
      const { count } = await supabase.from("workflows").select("*", { count: "exact", head: true }).eq("id", id).eq("user_id", user.id);
      if (count && count > 0) throw new ApiError(409, "errors.conflict");
      throw new ApiError(404, "errors.notFound");
    }
    return json({ workflow: data });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  try {
    sameOrigin(request);
    const { id } = await ctx.params;
    requireId(id);
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflows").delete().eq("id", id).eq("user_id", user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "errors.notFound");
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
