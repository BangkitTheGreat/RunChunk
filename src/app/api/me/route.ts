import { apiError, authenticate, json } from "@/lib/api";

/** Plan and usage of the signed-in user. Pro is a simulation set by an admin; nothing here can change it. */
export async function GET() {
  try {
    const { supabase } = await authenticate();
    const { data, error } = await supabase.rpc("my_usage").single();
    if (error) throw error;
    const row = data as { plan: string; runs: number; quota: number; active_workflows: number; active_limit: number; webhook_per_minute: number; period_start: string };
    return json({
      plan: row.plan, runs: row.runs, quota: row.quota, activeWorkflows: row.active_workflows,
      activeLimit: row.active_limit, webhookPerMinute: row.webhook_per_minute, periodStart: row.period_start,
    });
  } catch (error) { return apiError(error); }
}
