import { apiError, authenticate, json, requireId } from "@/lib/api";

/** Newest-first list of saved versions (counts only; the definition comes from the per-version route). */
export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]/versions">) {
  try {
    const id = requireId((await ctx.params).id);
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflow_version_summaries")
      .select("version,name,route_color,created_at,node_count,edge_count")
      .eq("workflow_id", id).eq("user_id", user.id)
      .order("version", { ascending: false }).limit(20);
    if (error) throw error;
    return json({ versions: data });
  } catch (error) { return apiError(error); }
}
