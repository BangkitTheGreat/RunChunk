#!/usr/bin/env node
// Scan git-tracked files for committed secrets. Prints file:line and rule only, never the value.
// ponytail: working tree only; scan full history with `gitleaks git` before making the repo public.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["JWT (Supabase anon/service_role)", /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/],
  ["Supabase secret key", /\bsb_secret_[\w-]{16,}/],
  ["Inngest signing key", /\bsignkey-(?:prod|test|branch)-[0-9a-f]{16,}/],
  ["GitHub token", /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/],
  ["Google API key", /\bAIza[\w-]{35}\b/],
  ["Postgres URL with password", /postgres(?:ql)?:\/\/[^:\s/@]+:[^@\s]+@(?!127\.0\.0\.1|localhost)/],
  // Any KEY/SECRET/TOKEN assignment whose value is not an obvious placeholder.
  ["secret-like assignment", /\b[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*["']?(?!YOUR_|<|\$\{|process\.env)([A-Za-z0-9+/=_-]{20,})/],
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
let hits = 0;
for (const file of files) {
  if (file === "package-lock.json" || file === "scripts/check-secrets.mjs") continue;
  let text;
  try { text = readFileSync(file); } catch { continue; } // deleted but still indexed
  if (text.includes(0)) continue; // binary
  text.toString("utf8").split("\n").forEach((line, i) => {
    for (const [name, re] of RULES) {
      if (re.test(line)) { hits++; console.error(`${file}:${i + 1}: ${name}`); break; }
    }
  });
}
if (hits) {
  console.error(`\n${hits} possible secret(s). Remove them and rotate the exposed keys.`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} tracked files.`);
