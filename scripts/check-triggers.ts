import assert from "node:assert/strict";
import { scheduleConfig, triggerNode, validateDefinition } from "../src/lib/workflow/validate";
import { isValidCron, isValidTimezone, nextRunAt, nextRuns } from "../src/lib/workflow/schedule";
import { executeWorkflow, type EngineDeps, type LogEntry } from "../src/lib/workflow/engine";
import { dispatchSlot, type DispatchDeps, type DueSchedule } from "../src/lib/executions/dispatch";
import { startExecution, type StartDeps, type StartInput } from "../src/lib/executions/start";
import { TOKEN_PATTERN, buildTriggerData, generateToken, hashToken, parseWebhookBody, tokenHint, webhookUrl } from "../src/lib/webhook";
import type { WorkflowNode } from "../src/lib/workflow/types";

const node = (id: string, type: WorkflowNode["type"], data: Record<string, unknown> = {}): WorkflowNode => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${sourceHandle ?? "out"}-${target}`, source, target, sourceHandle: sourceHandle ?? null });
const WF = "10000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000a";

function validationChecks() {
  const bad = (definition: unknown, label: string) => assert.throws(() => validateDefinition(definition), /errors\.invalidWorkflow/, label);
  assert.doesNotThrow(() => validateDefinition({ nodes: [node("t", "trigger.webhook"), node("o", "output.response")], edges: [edge("t", "o")] }));
  assert.doesNotThrow(() => validateDefinition({ nodes: [node("t", "trigger.schedule", { cron: "0 9 * * 1-5", timezone: "Asia/Jakarta" })], edges: [] }));
  assert.doesNotThrow(() => validateDefinition({ nodes: [node("t", "trigger.schedule", { cron: "" })], edges: [] }), "draft without cron saves");
  bad({ nodes: [node("t", "trigger.manual"), node("w", "trigger.webhook")], edges: [] }, "two triggers of different kinds");
  bad({ nodes: [node("t", "trigger.webhook"), node("s", "trigger.schedule", { cron: "* * * * *" })], edges: [] }, "webhook + schedule");
  bad({ nodes: [node("a", "action.http")], edges: [] }, "no trigger");
  bad({ nodes: [node("t", "trigger.webhook"), node("a", "action.http")], edges: [edge("a", "t")] }, "edge into webhook trigger");
  bad({ nodes: [node("t", "trigger.schedule", { cron: "61 * * * *" })], edges: [] }, "minute out of range");
  bad({ nodes: [node("t", "trigger.schedule", { cron: "*/5 * * * * *" })], edges: [] }, "six-field cron");
  bad({ nodes: [node("t", "trigger.schedule", { cron: "* * * * *", timezone: "Nowhere/City" })], edges: [] }, "unknown timezone");
  bad({ nodes: [node("t", "trigger.schedule", { cron: 5 })], edges: [] }, "non-string cron");

  const scheduled = validateDefinition({ nodes: [node("t", "trigger.schedule", { cron: " 0 9 * * * ", timezone: "Asia/Jakarta" })], edges: [] });
  assert.equal(triggerNode(scheduled).id, "t");
  assert.deepEqual(scheduleConfig(scheduled), { cron: "0 9 * * *", timezone: "Asia/Jakarta" });
  assert.equal(scheduleConfig(validateDefinition({ nodes: [node("t", "trigger.schedule", { cron: "0 9 * * *" })], edges: [] }))!.timezone, "UTC", "timezone defaults to UTC");
  assert.equal(scheduleConfig(validateDefinition({ nodes: [node("t", "trigger.schedule")], edges: [] })), null, "no cron -> not runnable");
  assert.equal(scheduleConfig(validateDefinition({ nodes: [node("t", "trigger.webhook")], edges: [] })), null);
}

function cronChecks() {
  assert.equal(isValidCron("* * * * *"), true);
  assert.equal(isValidCron("0 9 * * 1-5"), true);
  assert.equal(isValidCron("*/5 * * * * *"), false, "seconds field rejected");
  assert.equal(isValidCron("0 9 * *"), false);
  assert.equal(isValidCron("bad"), false);
  assert.equal(isValidTimezone("Asia/Jakarta"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Nowhere/City"), false);
  assert.equal(isValidTimezone(""), false);
  // Timezone: 09:00 Jakarta (UTC+7, no DST) is 02:00Z.
  assert.equal(nextRunAt("0 9 * * *", "Asia/Jakarta", new Date("2026-03-01T00:00:00Z"))!.toISOString(), "2026-03-01T02:00:00.000Z");
  assert.equal(nextRunAt("0 9 * * *", "Asia/Jakarta", new Date("2026-03-01T02:00:00Z"))!.toISOString(), "2026-03-02T02:00:00.000Z", "strictly after `from`");
  // DST: Europe/Berlin springs forward on 2026-03-29 (02:00 -> 03:00); 02:30 local does not exist that day
  // and fires at the next valid instant, then resumes at 02:30 CEST (00:30Z).
  const berlin = nextRuns("30 2 * * *", "Europe/Berlin", new Date("2026-03-28T12:00:00Z"), 2).map((d) => d.toISOString());
  assert.deepEqual(berlin, ["2026-03-29T01:30:00.000Z", "2026-03-30T00:30:00.000Z"]);
  assert.equal(nextRunAt("bad", "UTC", new Date()), null);
  assert.equal(nextRunAt("* * * * *", "Nowhere/City", new Date()), null);
  assert.equal(nextRunAt("0 0 31 2 *", "UTC", new Date()), null, "never fires -> null");
}

async function engineTriggerChecks() {
  const logs: LogEntry[] = [];
  const memo = new Map<string, unknown>();
  const deps: EngineDeps = {
    step: {
      async run<T>(id: string, fn: () => Promise<T>) { if (!memo.has(id)) memo.set(id, JSON.parse(JSON.stringify((await fn()) ?? null))); return memo.get(id) as T; },
      async sleep() {},
    },
    async writeLog(entry) { logs.push(entry); },
    async http() { throw new Error("no http"); },
    now: () => 1_000_000,
  };
  const definition = validateDefinition({
    nodes: [
      node("t", "trigger.webhook"),
      node("c", "control.condition", { left: "{{$json.body.email}}", operator: "exists" }),
      node("ok", "output.response", { value: "{{$trigger.body.email}}" }),
      node("no", "output.response", { value: "missing" }),
    ],
    edges: [edge("t", "c"), edge("c", "ok", "true"), edge("c", "no", "false")],
  });
  const triggerData = { method: "POST", query: { source: "form" }, headers: {}, body: { email: "a@b.c" }, receivedAt: "2026-09-28T00:00:00Z" };
  const output = await executeWorkflow({ definition, triggerData, runStartedAt: 1_000_000 }, deps);
  assert.equal(output, "a@b.c", "webhook body flows through $json / $trigger");
  assert.equal(logs.find((l) => l.nodeId === "no")!.status, "skipped");
}

async function startChecks() {
  const calls: string[] = [];
  const deps = (overrides: Partial<StartDeps> = {}, allowed = true): StartDeps => ({
    async reserve() { calls.push("reserve"); return { allowed, used: allowed ? 1 : 100, quota: 100, periodStart: "2026-09-01" }; },
    async release(_u, period) { calls.push(`release:${period}`); },
    async insertExecution(row) { calls.push(`insert:${row.trigger_source}:${row.status}`); },
    async markDispatchFailed() { calls.push("mark"); },
    async send(event) { calls.push(`send:${event.id ?? "-"}`); },
    ...overrides,
  });
  const input: StartInput = { workflowId: WF, userId: USER, definition: { nodes: [node("t", "trigger.manual")], edges: [] }, version: 1, triggerSource: "webhook", triggerData: { body: 1 }, eventId: "evt-1" };

  calls.length = 0;
  const ok = await startExecution(input, deps());
  assert.ok(ok.ok);
  assert.deepEqual(calls, ["reserve", "insert:webhook:pending", "send:evt-1"], "happy path never releases");

  calls.length = 0;
  const denied = await startExecution(input, deps({}, false));
  assert.deepEqual(denied, { ok: false, reason: "quota", used: 100, quota: 100 });
  assert.deepEqual(calls, ["reserve"], "nothing inserted or sent when over quota");

  calls.length = 0;
  const failed = await startExecution(input, deps({ async send() { throw new Error("inngest down"); } }));
  assert.equal(failed.ok, false);
  assert.equal((failed as { reason: string }).reason, "dispatch");
  assert.deepEqual(calls, ["reserve", "insert:webhook:pending", "mark", "release:2026-09-01"], "dispatch failure marks the row and refunds the run");

  calls.length = 0;
  await assert.rejects(startExecution(input, deps({ async insertExecution() { throw new Error("db down"); } })));
  assert.deepEqual(calls, ["reserve", "release:2026-09-01"], "insert failure refunds the run");
}

async function dispatchChecks() {
  const slot = "2026-09-28T09:00:00.000Z";
  const row: DueSchedule = { id: "s1", workflow_id: WF, user_id: USER, cron: "0 9 * * *", timezone: "UTC", next_run_at: slot };
  const definition = { nodes: [node("t", "trigger.schedule", { cron: "0 9 * * *", timezone: "UTC" }), node("o", "output.response")], edges: [edge("t", "o")] };
  const make = (overrides: Partial<DispatchDeps> = {}) => {
    const calls: string[] = [];
    const deps: DispatchDeps = {
      // Two days after the missed slot: the next slot must come from now (no catch-up), not from the slot.
      now: () => new Date("2026-09-30T09:00:20.000Z"),
      async listDue() { return [row]; },
      async claim(id, expected, next) { calls.push(`claim:${id}:${expected}->${next}`); return true; },
      async loadWorkflow() { return { definition, version: 3, is_active: true }; },
      async start(input) { calls.push(`start:${input.triggerSource}:${(input.triggerData as { scheduledAt: string }).scheduledAt}:${input.eventId}`); return { ok: true, executionId: "e1" }; },
      async pause(_w, _u, reason) { calls.push(`pause:${reason}`); },
      async removeSchedule(id) { calls.push(`remove:${id}`); },
      ...overrides,
    };
    return { deps, calls };
  };

  {
    const { deps, calls } = make();
    assert.equal(await dispatchSlot(row, deps), "started");
    assert.deepEqual(calls, [`claim:s1:${slot}->2026-10-01T09:00:00.000Z`, `start:schedule:${slot}:schedule:s1:${slot}`], "next slot computed from now (missed slots are not caught up), event id carries the slot");
  }
  {
    const { deps, calls } = make({ async claim() { return false; } });
    assert.equal(await dispatchSlot(row, deps), "lost-claim");
    assert.equal(calls.length, 0, "losing the claim starts nothing");
  }
  {
    const { deps, calls } = make({ async loadWorkflow() { return { definition, version: 1, is_active: false }; } });
    assert.equal(await dispatchSlot(row, deps), "inactive");
    assert.ok(!calls.some((c) => c.startsWith("start")));
  }
  {
    const { deps, calls } = make({ async start() { return { ok: false, reason: "quota", used: 100, quota: 100 }; } });
    assert.equal(await dispatchSlot(row, deps), "paused-quota");
    assert.ok(calls.includes("pause:errors.quotaExceeded"), "quota exhaustion pauses the schedule");
  }
  {
    const { deps, calls } = make({ async loadWorkflow() { return { definition: { nodes: [] }, version: 1, is_active: true }; } });
    assert.equal(await dispatchSlot(row, deps), "paused-invalid");
    assert.ok(calls.includes("pause:errors.invalidWorkflow"));
  }
  {
    const { deps, calls } = make();
    assert.equal(await dispatchSlot({ ...row, cron: "0 0 31 2 *" }, deps), "paused-invalid", "a cron that never fires is removed");
    assert.deepEqual(calls, ["remove:s1", "pause:errors.scheduleInvalid"]);
  }
  // Two dispatchers racing on the same slot: the shared compare-and-swap lets exactly one start.
  {
    const table = new Map([[row.id, row.next_run_at]]);
    let started = 0;
    const racer = () => make({
      async claim(id, expected, next) { if (table.get(id) !== expected) return false; table.set(id, next); return true; },
      async start() { started++; return { ok: true, executionId: `e${started}` }; },
    }).deps;
    const outcomes = await Promise.all([dispatchSlot(row, racer()), dispatchSlot(row, racer()), dispatchSlot(row, racer())]);
    assert.equal(started, 1, "one execution per slot");
    assert.deepEqual(outcomes.sort(), ["lost-claim", "lost-claim", "started"]);
    assert.equal(table.get("s1"), "2026-10-01T09:00:00.000Z");
  }
}

function webhookChecks() {
  const token = generateToken();
  assert.match(token, TOKEN_PATTERN);
  assert.notEqual(generateToken(), token);
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(generateToken()));
  assert.equal(tokenHint(token), token.slice(-4));
  assert.equal(webhookUrl(token, "https://runchunk.example"), `https://runchunk.example/api/v1/webhooks/${token}`);
  assert.equal(TOKEN_PATTERN.test("../etc/passwd"), false);
  assert.equal(TOKEN_PATTERN.test(token + "x"), false);

  assert.deepEqual(parseWebhookBody("application/json; charset=utf-8", '{"a":1}'), { a: 1 });
  assert.deepEqual(parseWebhookBody("application/vnd.api+json", '{"a":1}'), { a: 1 });
  assert.deepEqual(parseWebhookBody("application/x-www-form-urlencoded", "email=a%40b.c&n=1"), { email: "a@b.c", n: "1" });
  assert.equal(parseWebhookBody("text/plain", "hello"), "hello");
  assert.equal(parseWebhookBody(null, ""), null);
  assert.throws(() => parseWebhookBody("application/json", "{oops"), /errors\.webhookInvalidJson/);

  const data = buildTriggerData({
    method: "POST", url: "https://runchunk.example/api/v1/webhooks/x?source=form&id=7",
    headers: new Headers({ "content-type": "application/json", authorization: "Bearer leak", cookie: "sid=1", "x-api-key": "k", "user-agent": "curl/8" }),
  }, { ok: true }, new Date("2026-09-28T00:00:00Z"));
  assert.deepEqual(data, {
    method: "POST", query: { source: "form", id: "7" }, headers: { "content-type": "application/json", "user-agent": "curl/8" },
    body: { ok: true }, receivedAt: "2026-09-28T00:00:00.000Z",
  }, "auth headers and cookies never enter trigger data");
}

async function main() {
  validationChecks();
  cronChecks();
  await engineTriggerChecks();
  await startChecks();
  await dispatchChecks();
  webhookChecks();
  console.log("All trigger, schedule, quota-path and webhook checks PASSED.");
}

main().catch((err: unknown) => {
  console.error("Trigger checks failed:", err);
  process.exit(1);
});
