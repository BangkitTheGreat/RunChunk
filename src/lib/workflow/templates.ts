import type { WorkflowDefinition } from "./types";

// Starter templates. Public endpoints only, nothing that needs a credential, so a fresh account can run
// them as-is. Names and descriptions come from the message catalog (dashboard.templates.<key>).

export interface StarterTemplate {
  key: "httpCheck" | "webhookLead";
  routeColor: number;
  definition: WorkflowDefinition;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    // Manual -> HTTP GET (public JSON) -> condition on status -> two outputs.
    key: "httpCheck",
    routeColor: 1,
    definition: {
      nodes: [
        { id: "manual", type: "trigger.manual", position: { x: 40, y: 160 }, data: {} },
        { id: "fetch", type: "action.http", position: { x: 300, y: 160 }, data: { url: "https://httpbin.org/json", method: "GET", headers: {}, retries: 1 } },
        { id: "check", type: "control.condition", position: { x: 560, y: 160 }, data: { left: "{{$json.status}}", operator: "equals", right: "200" } },
        { id: "ok", type: "output.response", position: { x: 840, y: 60 }, data: { value: "{{$json.data}}" } },
        { id: "failed", type: "output.response", position: { x: 840, y: 260 }, data: { value: "HTTP {{$json.status}}" } },
      ],
      edges: [
        { id: "e-manual-fetch", source: "manual", target: "fetch", sourceHandle: null },
        { id: "e-fetch-check", source: "fetch", target: "check", sourceHandle: null },
        { id: "e-check-true-ok", source: "check", target: "ok", sourceHandle: "true" },
        { id: "e-check-false-failed", source: "check", target: "failed", sourceHandle: "false" },
      ],
    },
  },
  {
    // Webhook -> validate body -> store summary as variables -> output; invalid input gets its own output.
    key: "webhookLead",
    routeColor: 2,
    definition: {
      nodes: [
        { id: "webhook", type: "trigger.webhook", position: { x: 40, y: 160 }, data: {} },
        { id: "check", type: "control.condition", position: { x: 300, y: 160 }, data: { left: "{{$json.body.email}}", operator: "exists" } },
        { id: "lead", type: "action.set_variable", position: { x: 580, y: 60 }, data: { values: { email: "{{$json.body.email}}", name: "{{$json.body.name}}", receivedAt: "{{$json.receivedAt}}" } } },
        { id: "saved", type: "output.response", position: { x: 860, y: 60 }, data: { value: "{{$json}}" } },
        { id: "invalid", type: "output.response", position: { x: 580, y: 260 }, data: { value: "invalid: email missing" } },
      ],
      edges: [
        { id: "e-webhook-check", source: "webhook", target: "check", sourceHandle: null },
        { id: "e-check-true-lead", source: "check", target: "lead", sourceHandle: "true" },
        { id: "e-lead-saved", source: "lead", target: "saved", sourceHandle: null },
        { id: "e-check-false-invalid", source: "check", target: "invalid", sourceHandle: "false" },
      ],
    },
  },
];
