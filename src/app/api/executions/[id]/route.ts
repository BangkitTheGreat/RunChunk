import { ApiError, apiError, authenticate, json, requireId } from "@/lib/api";

export async function GET(_request: Request, ctx: RouteContext<"/api/executions/[id]">) {
  try {
    const { id } = await ctx.params;
    requireId(id);
    const { supabase, user } = await authenticate();
    const { data: execution, error } = await supabase
      .from("executions")
      .select("id,workflow_id,status,definition_snapshot,definition_version,trigger_data,started_at,finished_at,created_at,output,error")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!execution) throw new ApiError(404, "errors.notFound");
    const { data: logs, error: logError } = await supabase
      .from("execution_logs")
      .select("node_id,status,summary,output,duration_ms,created_at")
      .eq("execution_id", id)
      .order("created_at", { ascending: true });
    if (logError) throw logError;
    return json({ execution, logs });
  } catch (error) { return apiError(error); }
}
