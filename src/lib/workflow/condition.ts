import type { ConditionOperator } from "./types";

// Condition operators are a fixed enum evaluated here by trusted server code. Operands come from the
// path-only expression resolver; nothing in a workflow is ever evaluated as code.

type Scalar = string | number | boolean | null;

/**
 * Coercion so UI-typed text compares with resolved values: `{{$json.status}}` yields the number 404
 * while the right field holds the string "404". Numeric strings become numbers, "true"/"false"
 * become booleans, objects/arrays compare by their JSON text.
 */
function normalize(value: unknown): Scalar {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim();
    if (text !== "" && Number.isFinite(Number(text))) return Number(text);
    if (text === "true" || text === "false") return text === "true";
    return value;
  }
  return JSON.stringify(value);
}

function numeric(value: unknown): number {
  const normalized = normalize(value);
  if (typeof normalized !== "number") throw new Error("errors.conditionNotNumber");
  return normalized;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function evaluateCondition(operator: ConditionOperator, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "equals":
      return normalize(left) === normalize(right);
    case "not_equals":
      return normalize(left) !== normalize(right);
    case "contains":
      if (Array.isArray(left)) return left.some((item) => normalize(item) === normalize(right));
      if (typeof left === "string") return right !== undefined && right !== null && left.includes(String(right));
      return false;
    case "gt":
      return numeric(left) > numeric(right);
    case "lt":
      return numeric(left) < numeric(right);
    case "exists":
      return left !== undefined && left !== null;
    case "is_empty":
      return isEmpty(left);
    default:
      throw new Error("errors.invalidWorkflow");
  }
}
