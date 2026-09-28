const expression = /\{\{\s*\$(json|node|vars|trigger)(?:\.([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*))?\s*\}\}/g;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const LIMIT = 1_000_000;

export interface ExpressionScope {
  json: unknown;
  node: Record<string, unknown>;
  vars: Record<string, unknown>;
  trigger: unknown;
}

function pathValue(root: unknown, path: string | undefined): unknown {
  if (!path) return root;
  for (const segment of path.split(".")) {
    if (forbidden.has(segment) || !root || typeof root !== "object" || !Object.prototype.hasOwnProperty.call(root, segment)) return undefined;
    // JSON values only: descriptors block getter execution even if caller passes a non-JSON object.
    const descriptor = Object.getOwnPropertyDescriptor(root, segment);
    if (!descriptor || !("value" in descriptor)) return undefined;
    root = descriptor.value;
  }
  return root;
}

export function resolveExpression(value: unknown, scope: ExpressionScope, depth = 0): unknown {
  if (depth > 32) throw new Error("errors.expressionTooLarge");
  if (value == null) return value;
  if (typeof value === "object") {
    const out: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    let bytes = 0;
    for (const key of Object.keys(value)) {
      if (forbidden.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new Error("errors.invalidExpression");
      const resolved = resolveExpression(descriptor.value, scope, depth + 1);
      bytes += Buffer.byteLength(JSON.stringify(resolved) ?? "null") + Buffer.byteLength(key) + 4;
      if (bytes > LIMIT) throw new Error("errors.expressionTooLarge");
      Object.defineProperty(out, key, { value: resolved, enumerable: true, configurable: true, writable: true });
    }
    return out;
  }
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value) > LIMIT) throw new Error("errors.expressionTooLarge");
  const matches = [...value.matchAll(expression)];
  if (!matches.length) {
    if (value.includes("{{")) throw new Error("errors.invalidExpression");
    return value;
  }
  const lookup = (match: RegExpMatchArray) => pathValue(scope[match[1] as keyof ExpressionScope], match[2]);
  if (matches.length === 1 && matches[0][0] === value) return lookup(matches[0]);
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    const literal = value.slice(cursor, match.index);
    if (literal.includes("{{")) throw new Error("errors.invalidExpression");
    const resolved = lookup(match);
    result += literal + (resolved == null ? "" : typeof resolved === "string" ? resolved : JSON.stringify(resolved));
    if (Buffer.byteLength(result) > LIMIT) throw new Error("errors.expressionTooLarge");
    cursor = match.index! + match[0].length;
  }
  const ending = value.slice(cursor);
  if (ending.includes("{{")) throw new Error("errors.invalidExpression");
  result += ending;
  if (Buffer.byteLength(result) > LIMIT) throw new Error("errors.expressionTooLarge");
  return result;
}
