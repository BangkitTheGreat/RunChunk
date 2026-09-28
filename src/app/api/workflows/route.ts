import { apiError, authenticate, json, readJson, sameOrigin, workflowName } from "@/lib/api";
import { validateDefinition } from "@/lib/workflow/validate";

export async function GET() {
  try {
    const { supabase, user } = await authenticate();
    const { data, error } = await supabase.from("workflows").select("id,name,definition,version,created_at,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(100);
    if (error) throw error;
    return json({ workflows: data });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { supabase, user } = await authenticate();
    const body = await readJson(request);
    const name = workflowName(body.name);
    const definition = validateDefinition(body.definition);
    const { data, error } = await supabase.from("workflows").insert({ user_id: user.id, name, definition }).select("id,name,definition,version,created_at,updated_at").single();
    if (error) throw error;
    return json({ workflow: data }, 201);
  } catch (error) { return apiError(error); }
}
