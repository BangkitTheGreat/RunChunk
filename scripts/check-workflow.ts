import assert from "node:assert/strict";
import http from "node:http";
import { validateDefinition } from "../src/lib/workflow/validate";
import { resolveExpression } from "../src/lib/workflow/expression";
import { isNonPublicIp, safeFetch } from "../src/lib/workflow/http";

async function main() {
  // 1. IP validation boundary checks
  const blockedIps = [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "127.0.0.2",
    "169.254.169.254", // AWS/GCP metadata
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "fe80::1",
    "fc00::1",
    "fd00::1",
    "2001:db8::1",
    "64:ff9b::127.0.0.1",
  ];
  for (const ip of blockedIps) {
    assert.equal(isNonPublicIp(ip), true, `Expected ${ip} to be blocked`);
  }
  assert.throws(() => validateDefinition({
    nodes: [{ id: "t1", type: "trigger.manual", position: { x: 0, y: 0 }, data: {} }, { id: "a1", type: "action.http", position: { x: 0, y: 0 }, data: {} }],
    edges: [{ id: "e1", source: "t1", target: "a1" }, { id: "e2", source: "t1", target: "a1" }],
  }), /errors\.invalidWorkflow/);

  assert.throws(() => validateDefinition({
    nodes: [
      { id: "t1", type: "trigger.manual", position: { x: 0, y: 0 }, data: {} },
      { id: "a1", type: "action.http", position: { x: 0, y: 0 }, data: {} },
      { id: "a2", type: "action.http", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [{ id: "e1", source: "t1", target: "a1" }, { id: "e2", source: "a1", target: "a2" }, { id: "e3", source: "t1", target: "a2" }],
  }), /errors\.invalidWorkflow/);

  const publicIps = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"];
  for (const ip of publicIps) {
    assert.equal(isNonPublicIp(ip), false, `Expected ${ip} to be public`);
  }

  // 2. Safe HTTP local loopback reject
  await assert.rejects(
    () => safeFetch({ url: "http://127.0.0.1:8080" }),
    /errors\.httpBlockedAddress/,
  );
  await assert.rejects(
    () => safeFetch({ url: "http://localhost:8080" }),
    /errors\.httpBlockedAddress/,
  );
  await assert.rejects(
    () => safeFetch({ url: "file:///etc/passwd" }),
    /errors\.httpInvalidUrl/,
  );

  // 3. Expression boundary and prototype pollution resistance
  const scope = {
    json: { user: { name: "Alice", id: 42 } },
    node: { n1: { status: 200, data: { nested: "secret-value" } } },
    vars: { env: "prod" },
    trigger: { query: "hello" },
  };

  assert.equal(resolveExpression("{{$json.user.name}}", scope), "Alice");
  assert.equal(resolveExpression("{{$json.user.id}}", scope), 42); // Preserves type
  assert.equal(resolveExpression("User is {{$json.user.name}}", scope), "User is Alice");
  assert.equal(resolveExpression("{{$node.n1.data.nested}}", scope), "secret-value");
  assert.equal(resolveExpression("{{$vars.env}}", scope), "prod");
  assert.equal(resolveExpression("{{$trigger.query}}", scope), "hello");

  // Prototype access must evaluate to undefined
  assert.equal(resolveExpression("{{$json.__proto__}}", scope), undefined);
  assert.equal(resolveExpression("{{$json.constructor}}", scope), undefined);
  assert.equal(resolveExpression("{{$json.prototype}}", scope), undefined);

  // Invalid expressions must throw
  assert.deepEqual(resolveExpression({ nested: ["{{$json.user.name}}", "id={{$json.user.id}}"] }, scope), { nested: ["Alice", "id=42"] });
  assert.throws(() => resolveExpression("{{ eval('evil') }}", scope), /errors\.invalidExpression/);
  assert.throws(() => resolveExpression("x".repeat(1_000_001), scope), /errors\.expressionTooLarge/);
  assert.throws(() => resolveExpression("hello {{ not_allowed }}", scope), /errors\.invalidExpression/);

  // 4. DAG validation bounds & cycles
  const validDag = {
    nodes: [
      { id: "trig", type: "trigger.manual", position: { x: 0, y: 0 }, data: {} },
      { id: "act", type: "action.http", position: { x: 100, y: 0 }, data: { url: "https://example.com" } },
      { id: "out", type: "output.response", position: { x: 200, y: 0 }, data: { value: "{{$json}}" } },
    ],
    edges: [
      { id: "e1", source: "trig", target: "act" },
      { id: "e2", source: "act", target: "out" },
    ],
  };
  const validated = validateDefinition(validDag);
  assert.equal(validated.nodes.length, 3);

  // Cycle check
  const cyclicDag = {
    nodes: [
      { id: "trig", type: "trigger.manual", position: { x: 0, y: 0 }, data: {} },
      { id: "n1", type: "action.http", position: { x: 100, y: 0 }, data: {} },
      { id: "n2", type: "action.http", position: { x: 200, y: 0 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "trig", target: "n1" },
      { id: "e2", source: "n1", target: "n2" },
      { id: "e3", source: "n2", target: "n1" },
    ],
  };
  assert.throws(() => validateDefinition(cyclicDag), /errors\.invalidWorkflow/);

  // Reject unsupported node types
  const unsupportedDag = {
    nodes: [
      { id: "trig", type: "trigger.manual", position: { x: 0, y: 0 }, data: {} },
      { id: "code", type: "control.code", position: { x: 100, y: 0 }, data: {} },
    ],
    edges: [{ id: "e1", source: "trig", target: "code" }],
  };
  assert.throws(() => validateDefinition(unsupportedDag), /errors\.invalidWorkflow/);

  // Single trigger check
  const multiTrigger = {
    nodes: [
      { id: "trig1", type: "trigger.manual", position: { x: 0, y: 0 }, data: {} },
      { id: "trig2", type: "trigger.manual", position: { x: 50, y: 0 }, data: {} },
    ],
    edges: [],
  };
  assert.throws(() => validateDefinition(multiTrigger), /errors\.invalidWorkflow/);

  console.log("All boundary checks PASSED.");
}

main().catch((err: unknown) => {
  console.error("Boundary checks failed:", err);
  process.exit(1);
});
