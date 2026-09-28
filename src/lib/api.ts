import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { canonicalUuid } from "@/lib/ids";

export class ApiError extends Error {
  constructor(public status: number, key: string) { super(key); }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  if (error instanceof Error && (error.message === "errors.invalidWorkflow" || error.message === "errors.scheduleInvalid")) return json({ error: error.message }, 400);
  if (error instanceof Error && (error.message === "errors.setupRequired" || error.message === "errors.vaultNotConfigured")) return json({ error: error.message }, 503);
  console.error("Unhandled API Error", error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9]{4,8}$/.test(error.code) ? { code: error.code } : { type: error instanceof Error ? error.name : "unknown" });
  return json({ error: "errors.server" }, 500);
}

export function sameOrigin(request: Request) {
  const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(request.url).origin;
  if (request.headers.get("origin") !== expected) throw new ApiError(403, "errors.forbidden");
}

export async function readJson(request: Request, maxBytes = 270_000): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ApiError(415, "errors.invalidInput");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ApiError(413, "errors.tooLarge");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "errors.invalidInput");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, "errors.tooLarge"); }
    chunks.push(value);
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new ApiError(400, "errors.invalidInput"); }
}

export async function authenticate() {
  if (!isSupabaseConfigured()) throw new ApiError(503, "errors.setupRequired");
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, "errors.unauthorized");
  return { supabase, user };
}

/** Validates a UUID route param and returns its canonical lowercase form. */
export function requireId(id: string) {
  const canonical = canonicalUuid(id);
  if (!canonical) throw new ApiError(400, "errors.invalidInput");
  return canonical;
}

export function workflowName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new ApiError(400, "errors.invalidInput");
  return value.trim();
}
