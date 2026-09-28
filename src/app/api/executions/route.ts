import { apiError, authenticate, json, requireId } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticate();
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");
    const limitParam = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;

    let query = supabase
      .from("executions")
      .select("id,workflow_id,status,started_at,finished_at,created_at,error")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (workflowId) {
      requireId(workflowId);
      query = query.eq("workflow_id", workflowId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return json({ executions: data });
  } catch (error) { return apiError(error); }
}
