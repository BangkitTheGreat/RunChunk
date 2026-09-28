import { apiError, authenticate, json, readJson, sameOrigin, workflowName } from "@/lib/api";
import { validateDefinition } from "@/lib/workflow/validate";

const WORKFLOW_FIELDS = "id,name,definition,version,is_active,route_color,created_at,updated_at";
const ROUTE_COLORS = 6;

export async function GET() {
  try {
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflows").select(WORKFLOW_FIELDS).eq("user_id", user.id).order("updated_at", { ascending: false }).limit(100);
    if (error) throw error;
    // Latest execution per workflow for the dashboard strip (RLS-filtered view).
    const { data: latest, error: latestError } = await supabase.from("workflow_last_executions")
      .select("workflow_id,execution_id,status,trigger_source,created_at,finished_at").eq("user_id", user.id);
    if (latestError) throw latestError;
    const byWorkflow = new Map((latest ?? []).map((row) => [row.workflow_id, row]));
    return json({ workflows: data.map((workflow) => ({ ...workflow, last_execution: byWorkflow.get(workflow.id) ?? null })) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { supabase, user } = await authenticate();
    const body = await readJson(request);
    const name = workflowName(body.name);
    const definition = validateDefinition(body.definition);
    // Jalur color: picked round-robin (modulo 6) like the design spec; the user can change it later.
    const requested = Number(body.routeColor);
    const { count } = await supabase.from("workflows").select("*", { count: "exact", head: true }).eq("user_id", user.id);
    const route_color = Number.isInteger(requested) && requested >= 1 && requested <= ROUTE_COLORS ? requested : ((count ?? 0) % ROUTE_COLORS) + 1;
    const { data, error } = await supabase.from("workflows").insert({ user_id: user.id, name, definition, route_color }).select(WORKFLOW_FIELDS).single();
    if (error) throw error;
    return json({ workflow: data }, 201);
  } catch (error) { return apiError(error); }
}
