import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { evaluateCondition } from "../src/lib/workflow/condition";
import { validateDefinition } from "../src/lib/workflow/validate";
import { executeWorkflow, NodeFailure, type EngineDeps, type HttpAttemptResult, type HttpNodeRequest, type LogEntry } from "../src/lib/workflow/engine";
import { runHttpAttempt, type CredentialRow } from "../src/lib/workflow/http-node";
import { preview, redact, secretMatcher } from "../src/lib/workflow/redact";
import { decryptSecret, encryptSecret, type CredentialSecret } from "../src/lib/vault";
import { canonicalUuid } from "../src/lib/ids";
import type { SafeHttpRequest, SafeHttpResponse } from "../src/lib/workflow/http";
import type { WorkflowDefinition, WorkflowNode } from "../src/lib/workflow/types";

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const CRED = "30000000-0000-4000-8000-00000000000a";
process.env.CREDENTIALS_KEY_V1 = randomBytes(32).toString("base64");
process.env.CREDENTIALS_KEY_V2 = randomBytes(32).toString("base64");
delete process.env.CREDENTIALS_KEY_VERSION;

const node = (id: string, type: WorkflowNode["type"], data: Record<string, unknown> = {}): WorkflowNode => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${sourceHandle ?? "out"}-${target}`, source, target, sourceHandle: sourceHandle ?? null });
const ok = (status: number, data: unknown = {}): HttpAttemptResult => ({ ok: true, response: { status, headers: {}, data } });

interface Harness {
  logs: Map<string, LogEntry>;
  sleeps: [string, number][];
  requests: HttpNodeRequest[];
  deps: EngineDeps;
  stepIds: string[];
}

/** Fake Inngest: memoizes step results by ID (replay), rejects duplicate IDs within one run. */
function harness(http: (request: HttpNodeRequest, call: number) => Promise<HttpAttemptResult> | HttpAttemptResult, options: { now?: () => number; memo?: Map<string, unknown>; start?: number } = {}): Harness {
  const logs = new Map<string, LogEntry>();
  const sleeps: [string, number][] = [];
  const requests: HttpNodeRequest[] = [];
  const stepIds: string[] = [];
  const memo = options.memo ?? new Map<string, unknown>();
  const seen = new Set<string>();
  const claim = (id: string) => {
    assert.ok(!seen.has(id), `duplicate step id ${id}`);
    seen.add(id);
    stepIds.push(id);
  };
  // Clock advances 5 ms per read and by the full duration of every sleep, like wall time across Inngest invocations.
  let t = options.start ?? 1_000_000;
  const deps: EngineDeps = {
    step: {
      async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
        claim(id);
        if (memo.has(id)) return memo.get(id) as T;
        // Round-trip through JSON like Inngest step state.
        const value = await fn();
        const stored = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        memo.set(id, stored);
        return stored as T;
      },
      async sleep(id, seconds) {
        claim(id);
        sleeps.push([id, seconds]);
        t += seconds * 1000;
      },
    },
    async writeLog(entry) { logs.set(entry.nodeId, entry); },
    async http(request) {
      requests.push(request);
      return http(request, requests.length);
    },
    now: options.now ?? (() => (t += 5)),
  };
  return { logs, sleeps, requests, deps, stepIds };
}

const run = (definition: WorkflowDefinition, h: Harness, runStartedAt = 1_000_000) =>
  executeWorkflow({ definition: validateDefinition(definition), triggerData: {}, runStartedAt }, h.deps);

async function conditionChecks() {
  assert.equal(evaluateCondition("equals", 404, "404"), true, "number vs numeric text");
  assert.equal(evaluateCondition("equals", "404", 404), true);
  assert.equal(evaluateCondition("equals", 404, " 404 "), true);
  assert.equal(evaluateCondition("equals", 200, "404"), false);
  assert.equal(evaluateCondition("equals", true, "true"), true);
  assert.equal(evaluateCondition("equals", "abc", "abc"), true);
  assert.equal(evaluateCondition("equals", "abc", "ABC"), false);
  assert.equal(evaluateCondition("equals", { a: 1 }, '{"a":1}'), true);
  assert.equal(evaluateCondition("equals", undefined, null), true);
  assert.equal(evaluateCondition("equals", "", 0), false, "empty text is not zero");
  assert.equal(evaluateCondition("not_equals", 404, "200"), true);
  assert.equal(evaluateCondition("contains", "hello world", "world"), true);
  assert.equal(evaluateCondition("contains", ["a", 2], "2"), true);
  assert.equal(evaluateCondition("contains", { a: 1 }, "a"), false);
  assert.equal(evaluateCondition("gt", "10", 9), true);
  assert.equal(evaluateCondition("lt", 3, "3"), false);
  assert.throws(() => evaluateCondition("gt", "abc", 1), /errors\.conditionNotNumber/);
  assert.throws(() => evaluateCondition("lt", undefined, 1), /errors\.conditionNotNumber/);
  assert.equal(evaluateCondition("exists", 0, undefined), true);
  assert.equal(evaluateCondition("exists", null, undefined), false);
  for (const empty of [undefined, null, "", [], {}]) assert.equal(evaluateCondition("is_empty", empty, undefined), true);
  for (const full of [0, false, "x", [1], { a: 1 }]) assert.equal(evaluateCondition("is_empty", full, undefined), false);
}

function validationChecks() {
  const base = [node("t", "trigger.manual"), node("c", "control.condition", { left: "{{$json.x}}", operator: "equals", right: "1" }), node("o", "output.response")];
  const bad = (definition: unknown, label: string) => assert.throws(() => validateDefinition(definition), /errors\.invalidWorkflow/, label);
  bad({ nodes: base, edges: [edge("t", "c"), edge("c", "o")] }, "condition edge without port");
  bad({ nodes: base, edges: [edge("t", "c"), edge("c", "o", "maybe")] }, "condition edge with unknown port");
  bad({ nodes: base, edges: [edge("t", "c", "true"), edge("c", "o", "true")] }, "port on non-condition source");
  bad({ nodes: base, edges: [edge("t", "c"), edge("c", "o", "true"), edge("c", "o", "false")] }, "duplicate source/target pair");
  bad({ nodes: [...base, node("x", "action.http")], edges: [edge("t", "c"), edge("c", "o", "true"), edge("o", "x")] }, "edge out of output");
  bad({ nodes: base.map((n) => n.id === "c" ? { ...n, data: { operator: "matches" } } : n), edges: [] }, "unknown operator");
  bad({ nodes: [node("t", "trigger.manual"), node("d", "control.delay", { amount: 61, unit: "m" })], edges: [] }, "delay over one hour");
  bad({ nodes: [node("t", "trigger.manual"), node("d", "control.delay", { amount: 0, unit: "s" })], edges: [] }, "zero delay");
  bad({ nodes: [node("t", "trigger.manual"), node("d", "control.delay", { amount: 1.5, unit: "s" })], edges: [] }, "fractional delay");
  bad({ nodes: [node("t", "trigger.manual"), node("d", "control.delay", { amount: 1, unit: "d" })], edges: [] }, "unknown unit");
  const delays = Array.from({ length: 25 }, (_, i) => node(`d${i}`, "control.delay", { amount: 1, unit: "h" }));
  bad({ nodes: [node("t", "trigger.manual"), ...delays], edges: [] }, "run lifetime over 24h");
  assert.doesNotThrow(() => validateDefinition({ nodes: [node("t", "trigger.manual"), ...delays.slice(0, 23)], edges: [] }), "23h of delay fits");
  bad({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { retries: 4 })], edges: [] }, "retries over 3");
  bad({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { credentialId: "../etc" })], edges: [] }, "credential id not uuid");
  bad({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { method: "TRACE" })], edges: [] }, "method not allowed");
  bad({ nodes: [node("t", "trigger.manual"), node("s", "action.set_variable", { values: { __proto__x: 1, "bad key": 1 } })], edges: [] }, "variable key");
  bad({ nodes: [node("t", "trigger.manual"), node("s", "action.set_variable", { values: JSON.parse('{"__proto__":1}') })], edges: [] }, "__proto__ variable");
}

/** Demo shape: HTTP -> condition(status == 404) -> true: set var ; false: second HTTP -> both rejoin at output. */
const branching = (): WorkflowDefinition => ({
  nodes: [
    node("t", "trigger.manual"),
    node("h1", "action.http", { url: "https://api.example.com/items/1", method: "GET" }),
    node("c", "control.condition", { left: "{{$json.status}}", operator: "equals", right: "404" }),
    node("miss", "action.set_variable", { values: { found: false, code: "{{$json.status}}" } }),
    node("h2", "action.http", { url: "https://api.example.com/items/1/details" }),
    node("o", "output.response", { value: "{{$json}}" }),
  ],
  edges: [edge("t", "h1"), edge("h1", "c"), edge("c", "miss", "true"), edge("c", "h2", "false"), edge("miss", "o"), edge("h2", "o")],
});

async function engineChecks() {
  // Branching + rejoin: only the chosen branch runs, the other is skipped, the shared output runs once.
  {
    const h = harness(() => ok(404, { error: "not found" }));
    const output = await run(branching(), h) as Record<string, unknown>;
    assert.equal(h.requests.length, 1, "false-branch HTTP never sent");
    assert.equal(h.logs.get("c")!.summary, "condition.true");
    assert.equal(h.logs.get("miss")!.status, "success");
    assert.equal(h.logs.get("h2")!.status, "skipped");
    assert.equal(h.logs.get("o")!.status, "success");
    assert.equal(output.found, false);
    assert.equal(output.code, 404, "single expression keeps number type");
    assert.equal(output.status, 404, "set_variable merges into $json");
  }
  {
    const h = harness((_, call) => ok(call === 1 ? 200 : 201, { call }));
    const output = await run(branching(), h) as Record<string, unknown>;
    assert.equal(h.requests.length, 2);
    assert.equal(h.logs.get("c")!.summary, "condition.false");
    assert.equal(h.logs.get("miss")!.status, "skipped");
    assert.equal(output.status, 201);
  }
  // Two live branches rejoining without a Merge node: guarded, never run twice or silently.
  {
    const h = harness(() => ok(200));
    await assert.rejects(run({
      nodes: [node("t", "trigger.manual"), node("a", "action.set_variable", { values: { a: 1 } }), node("b", "action.set_variable", { values: { b: 1 } }), node("o", "output.response"), node("after", "output.response")],
      edges: [edge("t", "a"), edge("t", "b"), edge("a", "o"), edge("b", "o")],
    }, h), (error: unknown) => error instanceof NodeFailure && error.nodeId === "o" && error.reason === "errors.multipleActiveInputs");
    assert.equal(h.logs.get("o")!.status, "failed");
    assert.equal(h.logs.get("o")!.summary, "errors.multipleActiveInputs");
    assert.equal(h.logs.get("after")!.status, "skipped", "unrelated nodes still get a terminal log");
  }
  // Nested skip: everything downstream of an unchosen branch is skipped.
  {
    const h = harness(() => ok(200));
    await run({
      nodes: [node("t", "trigger.manual"), node("c", "control.condition", { left: "x", operator: "equals", right: "y" }), node("a", "action.http", { url: "https://a.example" }), node("b", "action.set_variable"), node("o", "output.response")],
      edges: [edge("t", "c"), edge("c", "a", "true"), edge("a", "b"), edge("b", "o")],
    }, h);
    for (const id of ["a", "b", "o"]) assert.equal(h.logs.get(id)!.status, "skipped", id);
    assert.equal(h.requests.length, 0);
  }
  // $vars, delay, and step IDs.
  {
    const h = harness(() => ok(200));
    const output = await run({
      nodes: [node("t", "trigger.manual"), node("s", "action.set_variable", { values: { region: "id" } }), node("d", "control.delay", { amount: 2, unit: "m" }), node("o", "output.response", { value: "region={{$vars.region}}" })],
      edges: [edge("t", "s"), edge("s", "d"), edge("d", "o")],
    }, h);
    assert.equal(output, "region=id");
    assert.deepEqual(h.sleeps, [["delay-d", 120]]);
  }
  // Retry: 429/5xx and network errors retry with 2s/4s backoff; each attempt is its own step.
  {
    const statuses = [503, 429, 200];
    const h = harness((_, call) => ok(statuses[call - 1]));
    await run({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { url: "https://x.example", retries: 3 })], edges: [edge("t", "h")] }, h);
    assert.equal(h.requests.length, 3);
    assert.deepEqual(h.sleeps.map(([, s]) => s), [2, 4]);
    assert.ok(h.stepIds.includes("node-h-attempt-0") && h.stepIds.includes("node-h-attempt-2"));
    assert.deepEqual((h.logs.get("h")!.output as { attempts: number }).attempts, 3);
  }
  {
    const h = harness(() => ok(500));
    await run({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { url: "https://x.example", retries: 1 })], edges: [edge("t", "h")] }, h);
    assert.equal(h.requests.length, 2, "retries exhausted -> last response kept");
    assert.equal(h.logs.get("h")!.status, "success", "a 5xx response is still data for a condition");
  }
  {
    const h = harness(() => ok(404));
    await run({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { url: "https://x.example", method: "POST", retries: 3 })], edges: [edge("t", "h")] }, h);
    assert.equal(h.requests.length, 1, "4xx is never retried");
  }
  {
    const h = harness((_, call) => call < 3 ? { ok: false, error: "errors.httpTimeout", retryable: true } : ok(200));
    await run({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { url: "https://x.example", retries: 2 })], edges: [edge("t", "h")] }, h);
    assert.equal(h.requests.length, 3, "timeouts are retried");
  }
  {
    const h = harness(() => ({ ok: false, error: "errors.httpBlockedAddress", retryable: false }));
    await assert.rejects(run({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { url: "http://10.0.0.1", retries: 3 })], edges: [edge("t", "h")] }, h));
    assert.equal(h.requests.length, 1, "policy errors are not retried");
    assert.equal(h.logs.get("h")!.summary, "errors.httpBlockedAddress");
  }
  // Run lifetime ceiling uses the memoized node start time.
  {
    const h = harness(() => ok(200), { now: () => 1_000_000 + 25 * 3600 * 1000 });
    await assert.rejects(run({ nodes: [node("t", "trigger.manual"), node("o", "output.response")], edges: [edge("t", "o")] }, h),
      (error: unknown) => error instanceof NodeFailure && error.reason === "errors.runTooLong");
  }
  // Replay: a second pass over the same memo sends no HTTP request and yields the same result.
  {
    const memo = new Map<string, unknown>();
    const first = harness(() => ok(404), { memo });
    const a = await run(branching(), first);
    const second = harness(() => { throw new Error("replay must not call HTTP"); }, { memo });
    const b = await run(branching(), second);
    assert.deepEqual(b, a);
    assert.equal(second.requests.length, 0);
  }
  // Second redaction layer: sensitive field names are masked in logs and output even when not from the Vault.
  {
    const h = harness(() => ok(200));
    const output = await run({ nodes: [node("t", "trigger.manual"), node("s", "action.set_variable", { values: { password: "hunter2-typed", note: "ok" } }), node("o", "output.response")], edges: [edge("t", "s"), edge("s", "o")] }, h);
    assert.ok(!JSON.stringify([...h.logs.values()]).includes("hunter2-typed"), "log preview masks sensitive keys");
    assert.deepEqual(output, { password: "[REDACTED]", note: "ok" });
  }
  // Condition errors fail the node with a translatable key.
  {
    const h = harness(() => ok(200));
    await assert.rejects(run({ nodes: [node("t", "trigger.manual"), node("c", "control.condition", { left: "abc", operator: "gt", right: "1" })], edges: [edge("t", "c")] }, h));
    assert.equal(h.logs.get("c")!.summary, "errors.conditionNotNumber");
  }
}

function vaultChecks() {
  const secret: CredentialSecret = { type: "bearer", value: "sk-live-0123456789" };
  const a = encryptSecret(secret, USER, CRED);
  const b = encryptSecret(secret, USER, CRED);
  assert.notEqual(a.nonce, b.nonce, "nonce is unique per encryption");
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(Buffer.from(a.nonce, "base64").length, 12);
  assert.equal(Buffer.from(a.tag, "base64").length, 16);
  assert.ok(!Buffer.from(a.ciphertext, "base64").toString("utf8").includes("sk-live"), "ciphertext is not plaintext");
  assert.deepEqual(decryptSecret(a, USER, CRED), secret);
  assert.throws(() => decryptSecret(a, OTHER, CRED), /errors\.credentialDecryptFailed/, "AAD binds owner");
  assert.throws(() => decryptSecret(a, USER, "30000000-0000-4000-8000-00000000000b"), /errors\.credentialDecryptFailed/, "AAD binds credential id");
  const flipped = Buffer.from(a.ciphertext, "base64");
  flipped[0] ^= 1;
  assert.throws(() => decryptSecret({ ...a, ciphertext: flipped.toString("base64") }, USER, CRED), /errors\.credentialDecryptFailed/, "tamper detected");
  assert.throws(() => decryptSecret({ ...a, key_version: 2 }, USER, CRED), /errors\.credentialDecryptFailed/, "key version is authenticated");
  // AAD purpose: a webhook signing secret sealed for one endpoint can never open as a credential.
  const signing = encryptSecret({ type: "webhook_secret", value: "whsec-0123456789" }, USER, CRED, "webhook-signing");
  assert.deepEqual(decryptSecret(signing, USER, CRED, "webhook-signing"), { type: "webhook_secret", value: "whsec-0123456789" });
  assert.throws(() => decryptSecret(signing, USER, CRED), /errors\.credentialDecryptFailed/, "purpose is authenticated");
  assert.throws(() => decryptSecret(a, USER, CRED, "webhook-signing"), /errors\.credentialDecryptFailed/);
  process.env.CREDENTIALS_KEY_VERSION = "2";
  const v2 = encryptSecret(secret, USER, CRED);
  assert.equal(v2.key_version, 2);
  assert.deepEqual(decryptSecret(a, USER, CRED), secret, "old version readable after rotation");
  delete process.env.CREDENTIALS_KEY_VERSION;
  const saved = process.env.CREDENTIALS_KEY_V1;
  delete process.env.CREDENTIALS_KEY_V1;
  assert.throws(() => encryptSecret(secret, USER, CRED), /errors\.vaultNotConfigured/);
  process.env.CREDENTIALS_KEY_V1 = "c2hvcnQ=";
  assert.throws(() => encryptSecret(secret, USER, CRED), /errors\.vaultNotConfigured/, "key must be 32 bytes");
  process.env.CREDENTIALS_KEY_V1 = saved;
}

function redactionChecks() {
  const variants = secretMatcher(["s3cr3t-value", "a/b c"]);
  assert.deepEqual(redact({ echo: "Bearer s3cr3t-value", url: "https://x?k=a%2Fb%20c" }, variants), { echo: "Bearer [REDACTED]", url: "https://x?k=[REDACTED]" });
  assert.deepEqual(redact({ access_token: "zzz", Authorization: "x", nested: [{ "set-cookie": "sid=1" }], token: null }), { access_token: "[REDACTED]", Authorization: "[REDACTED]", nested: [{ "set-cookie": "[REDACTED]" }], token: null });
  assert.deepEqual(redact({ "s3cr3t-value": 1 }, variants), { "[REDACTED]": 1 }, "secrets in keys");
  const big = preview({ text: "é".repeat(5000) }, 100);
  assert.equal(big.truncated, true);
  assert.ok(Buffer.byteLength(big.preview) <= 100);
  assert.ok(!big.preview.includes("�"));
}

/** Echo server stand-in, like httpbin.org/anything: reflects request headers and body. */
async function echoFetch(request: SafeHttpRequest): Promise<SafeHttpResponse> {
  return { status: 200, headers: { "content-type": "application/json" }, data: { headers: request.headers, body: request.body, url: request.url, raw: JSON.stringify(request.headers) } };
}

async function httpNodeChecks() {
  const rows = new Map<string, CredentialRow>();
  const store = (id: string, secret: CredentialSecret, header_name: string | null) =>
    rows.set(id, { id, type: secret.type, header_name, ...encryptSecret(secret, USER, id) });
  const ids = { bearer: "30000000-0000-4000-8000-000000000001", key: "30000000-0000-4000-8000-000000000002", basic: "30000000-0000-4000-8000-000000000003" };
  store(ids.bearer, { type: "bearer", value: "tok-ABCDEFGH12345" }, null);
  store(ids.key, { type: "api_key", value: "key-ZYXWVUT98765" }, "x-api-key");
  store(ids.basic, { type: "basic", username: "demo", password: "pa55word!" }, null);
  const plaintexts = ["tok-ABCDEFGH12345", "key-ZYXWVUT98765", "pa55word!", Buffer.from("demo:pa55word!").toString("base64")];
  const sent: SafeHttpRequest[] = [];
  const deps = (userId = USER) => ({
    userId,
    loadCredential: async (id: string) => rows.get(id) ?? null,
    fetch: async (request: SafeHttpRequest) => { sent.push(request); return echoFetch(request); },
  });

  for (const credentialId of Object.values(ids)) {
    const result = await runHttpAttempt({ url: "https://httpbin.example/anything", method: "POST", headers: { "X-Trace": "1", Authorization: "typed-by-user" }, body: { hello: "world" }, credentialId }, deps());
    assert.ok(result.ok);
    const text = JSON.stringify(result);
    for (const plain of plaintexts) assert.ok(!text.includes(plain), `secret leaked in output for ${credentialId}`);
    assert.ok(!text.includes("typed-by-user"), "user-typed auth header value is scrubbed too");
  }
  assert.equal(sent[0].headers!.authorization, "Bearer tok-ABCDEFGH12345", "credential actually reaches the target");
  assert.ok(!("Authorization" in sent[0].headers!), "credential replaces a same-named typed header");
  assert.equal(sent[1].headers!["x-api-key"], "key-ZYXWVUT98765");
  assert.equal(sent[2].headers!.authorization, `Basic ${Buffer.from("demo:pa55word!").toString("base64")}`);

  assert.deepEqual(await runHttpAttempt({ url: "https://x.example", method: "GET", headers: {}, credentialId: "30000000-0000-4000-8000-0000000000ff" }, deps()),
    { ok: false, error: "errors.credentialNotFound", retryable: false });
  assert.deepEqual(await runHttpAttempt({ url: "https://x.example", method: "GET", headers: {}, credentialId: ids.bearer }, deps(OTHER)),
    { ok: false, error: "errors.credentialDecryptFailed", retryable: false }, "another user's row cannot be decrypted");
  assert.deepEqual(await runHttpAttempt({ url: "https://x.example", method: "GET", headers: {} }, { ...deps(), fetch: async () => { throw new Error("ECONNRESET 10.1.2.3"); } }),
    { ok: false, error: "errors.httpRequestFailed", retryable: true }, "raw network errors never surface");

  // End to end through the engine: nothing persisted or returned contains a plaintext secret.
  const logs: LogEntry[] = [];
  const h = harness(() => ok(0));
  h.deps.http = (request) => runHttpAttempt(request, deps());
  h.deps.writeLog = async (entry) => { logs.push(entry); };
  const output = await executeWorkflow({
    definition: validateDefinition({
      nodes: [
        node("t", "trigger.manual"),
        node("h", "action.http", { url: "https://httpbin.example/anything", method: "GET", credentialId: ids.bearer }),
        node("c", "control.condition", { left: "{{$json.status}}", operator: "equals", right: "200" }),
        node("s", "action.set_variable", { values: { copied: "{{$json.data.headers.authorization}}", raw: "{{$json.data.raw}}" } }),
        node("o", "output.response", { value: "{{$json}}" }),
      ],
      edges: [edge("t", "h"), edge("h", "c"), edge("c", "s", "true"), edge("s", "o")],
    }),
    triggerData: {}, runStartedAt: 1_000_000,
  }, h.deps);
  const persisted = JSON.stringify({ output, logs });
  for (const plain of plaintexts) assert.ok(!persisted.includes(plain), "secret reached logs or execution output");
  assert.ok(persisted.includes("[REDACTED]"));
  assert.equal(logs.find((entry) => entry.nodeId === "o" && entry.status === "success")!.status, "success");
}

/** Regressions from review (2026-09-28). Each block reproduced the bug before its fix. */
async function reviewRegressionChecks() {
  const DAY = 24 * 3600 * 1000;
  // 1. Every URL/form/JSON encoding of a Vault secret is scrubbed, whatever the percent-hex case.
  {
    const variants = secretMatcher(["demo key/123"]);
    for (const leak of ["demo key/123", "demo+key%2F123", "demo%20key%2f123", "demo%20key%2F123", "DEMO%20key/123".replace("DEMO", "demo"), "demo\\u0020key\\/123", "demo%2Bkey".replace("%2Bkey", "+key") + "%2f123"]) {
      const out = JSON.stringify(redact({ echo: `x=${leak}&y=1` }, variants));
      assert.ok(!out.includes("key"), `encoded secret leaked: ${leak} -> ${out}`);
    }
    assert.equal(redact("demo keys", variants), "demo keys", "no over-redaction of unrelated text");
  }
  // 2. The 24h ceiling stops retries and delays that cross it, replay-safely.
  {
    const statuses = [503, 200];
    const h = harness((_, call) => ok(statuses[call - 1]), { start: 1_000_000 });
    await assert.rejects(
      run({ nodes: [node("t", "trigger.manual"), node("h", "action.http", { url: "https://x.example", retries: 1 })], edges: [edge("t", "h")] }, h, 1_000_000 - DAY + 1_000),
      (error: unknown) => error instanceof NodeFailure && error.nodeId === "h" && error.reason === "errors.runTooLong",
    );
    assert.equal(h.requests.length, 1, "no attempt is sent after the deadline");
    assert.equal(h.logs.get("h")!.status, "failed");
  }
  {
    const h = harness(() => ok(200), { start: 1_000_000 });
    await assert.rejects(
      run({ nodes: [node("t", "trigger.manual"), node("d", "control.delay", { amount: 2, unit: "m" }), node("h", "action.http", { url: "https://x.example" })], edges: [edge("t", "d"), edge("d", "h")] }, h, 1_000_000 - DAY + 60_000),
      (error: unknown) => error instanceof NodeFailure && error.nodeId === "d" && error.reason === "errors.runTooLong",
    );
    assert.equal(h.logs.get("d")!.status, "failed", "a delay ending past the deadline is not a success");
    assert.equal(h.requests.length, 0);
  }
  {
    // Success is refused when the attempt itself finished past the deadline; replay keeps the verdict.
    const memo = new Map<string, unknown>();
    let clock = 1_000_000;
    const first = harness(async () => { clock += 5_000; return ok(200); }, { memo, now: () => clock });
    const input = { nodes: [node("t", "trigger.manual"), node("h", "action.http", { url: "https://x.example" })], edges: [edge("t", "h")] };
    await assert.rejects(run(input, first, 1_000_000 - DAY + 2_000), (e: unknown) => e instanceof NodeFailure && e.reason === "errors.runTooLong");
    clock = 0; // a replay with a different clock must reach the same verdict
    const second = harness(() => { throw new Error("replay must not call HTTP"); }, { memo, now: () => clock });
    await assert.rejects(run(input, second, 1_000_000 - DAY + 2_000), (e: unknown) => e instanceof NodeFailure && e.reason === "errors.runTooLong");
  }
  // 3. Tokens inside hand-typed auth headers are scrubbed on their own, not only as the full header.
  {
    const cases: [Record<string, string>, string[]][] = [
      [{ Authorization: "Bearer demo-secret-123" }, ["demo-secret-123"]],
      [{ authorization: `Basic ${Buffer.from("alice:pa55-w0rd").toString("base64")}` }, ["pa55-w0rd", "alice:pa55-w0rd"]],
      [{ "X-Api-Key": "k-987654321" }, ["k-987654321"]],
      [{ Cookie: "sid=abcdef123456; theme=dark" }, ["abcdef123456"]],
    ];
    for (const [headers, secrets] of cases) {
      const result = await runHttpAttempt({ url: "https://x.example", method: "GET", headers }, {
        userId: USER, loadCredential: async () => null,
        fetch: async () => ({ status: 200, headers: {}, data: { echo: secrets, text: secrets.join(" ") } }),
      });
      const text = JSON.stringify(result);
      for (const secret of secrets) assert.ok(!text.includes(secret), `typed header component leaked: ${secret}`);
    }
  }
  // 4. Unary operators never resolve the hidden right operand.
  {
    const h = harness(() => ok(200));
    await run({ nodes: [node("t", "trigger.manual"), node("c", "control.condition", { left: "{{$json}}", operator: "exists", right: "{{ broken" }), node("o", "output.response")], edges: [edge("t", "c"), edge("c", "o", "true")] }, h);
    assert.equal(h.logs.get("c")!.summary, "condition.true");
  }
  // 6. Credential IDs are canonical before they enter the AAD.
  {
    const upper = CRED.toUpperCase();
    assert.equal(canonicalUuid(upper), CRED, "IDs are canonicalized to lowercase");
    assert.equal(canonicalUuid("not-a-uuid"), null);
    const sealed = encryptSecret({ type: "bearer", value: "tok-UPPERCASE-1" }, USER.toUpperCase(), upper);
    assert.deepEqual(decryptSecret(sealed, USER, CRED), { type: "bearer", value: "tok-UPPERCASE-1" }, "AAD ignores UUID casing");
  }
}

async function main() {
  await reviewRegressionChecks();
  await conditionChecks();
  validationChecks();
  await engineChecks();
  vaultChecks();
  redactionChecks();
  await httpNodeChecks();
  console.log("All engine, vault and redaction checks PASSED.");
}

main().catch((err: unknown) => {
  console.error("Engine checks failed:", err);
  process.exit(1);
});
