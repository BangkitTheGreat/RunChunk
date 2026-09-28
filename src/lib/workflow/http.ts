import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

export interface SafeHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface SafeHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

const blockedV4 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(network, prefix, "ipv4");

function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null;
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    text = text.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const words = [...head, ...Array(fill).fill("0"), ...tail].map((word) => parseInt(word, 16));
  return words.length === 8 && words.every((word) => word >= 0 && word <= 0xffff) ? words : null;
}

/** True unless `ip` is a globally routable public unicast address. */
export function isNonPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) return blockedV4.check(ip, "ipv4");
  if (!net.isIPv6(ip)) return true;
  const w = expandV6(ip);
  if (!w) return true;
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // IPv4-mapped/compatible (::ffff:0:0/96, ::/96) and NAT64 64:ff9b::/96 carry an IPv4 target.
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return w[5] === 0 || isNonPublicIp(embeddedV4(w[6], w[7]));
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return isNonPublicIp(embeddedV4(w[6], w[7]));
  if (w[0] === 0x2002) return isNonPublicIp(embeddedV4(w[1], w[2])); // 6to4
  if ((w[0] & 0xe000) !== 0x2000) return true; // only 2000::/3 is global unicast
  if (w[0] === 0x2001 && (w[1] < 0x200 || w[1] === 0xdb8)) return true; // IETF special (Teredo, ORCHID, ...) + documentation
  return w[0] === 0x3fff && w[1] < 0x1000; // 3fff::/20 documentation
}

async function resolvePublic(hostname: string): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const records = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new Error("errors.httpDnsFailed");
  if (records.some((record) => isNonPublicIp(record.address))) throw new Error("errors.httpBlockedAddress");
  return records[0];
}

async function once(req: SafeHttpRequest, deadline: number): Promise<{ status: number; location?: string; response?: SafeHttpResponse }> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      throw new Error("errors.httpInvalidUrl");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error("errors.httpInvalidUrl");
    const method = (req.method ?? "GET").toUpperCase();
    if (!METHODS.has(method)) throw new Error("errors.httpInvalidMethod");
    const lookupTimeout = Promise.withResolvers<never>();
    const dnsTimer = setTimeout(() => lookupTimeout.reject(new Error("errors.httpTimeout")), Math.max(1, deadline - Date.now()));
    let pinned: { address: string; family: number };
    try {
      pinned = await Promise.race([resolvePublic(url.hostname), lookupTimeout.promise]);
    } finally {
      clearTimeout(dnsTimer);
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers ?? {})) {
      const name = key.toLowerCase();
      // Framing/routing headers are owned by the client; user values could smuggle or retarget requests.
      if (!["host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "keep-alive", "proxy-connection", "expect"].includes(name)) headers[name] = String(value);
    }
    let body: Buffer | undefined;
    if (req.body != null && method !== "GET" && method !== "HEAD") {
      body = Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
      if (typeof req.body !== "string") headers["content-type"] ??= "application/json";
      if (body.length > MAX_BYTES) throw new Error("errors.httpBodyTooLarge");
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("errors.httpTimeout");
    const { promise, resolve, reject } = Promise.withResolvers<{ status: number; location?: string; response?: SafeHttpResponse }>();
    let request: http.ClientRequest;
    try {
    request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        headers,
        agent: false,
        // Pin the socket to the validated address; Host header, SNI and cert checks keep the original hostname.
        lookup: (_host, options, callback) =>
          (options as { all?: boolean }).all
            ? (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned])
            : callback(null, pinned.address, pinned.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          clearTimeout(timer);
          try {
            resolve({ status, location: new URL(res.headers.location, url).toString() });
          } catch {
            reject(new Error("errors.httpInvalidUrl"));
          }
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy(new Error("errors.httpResponseTooLarge"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          clearTimeout(timer);
          const text = Buffer.concat(chunks).toString("utf8");
          let data: unknown = text;
          if (String(res.headers["content-type"] ?? "").includes("json")) {
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
          }
          const responseHeaders: Record<string, string> = {};
          for (const key of ["content-type", "content-length", "date"]) if (typeof res.headers[key] === "string") responseHeaders[key] = res.headers[key] as string;
          resolve({ status, response: { status, headers: responseHeaders, data } });
        });
      },
    );
    } catch {
      throw new Error("errors.httpInvalidHeaders");
    }
    const timer = setTimeout(() => request.destroy(new Error("errors.httpTimeout")), remaining);
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error.message.startsWith("errors.") ? error : new Error("errors.httpRequestFailed"));
    });
    request.end(body);
    return promise;
}

/** SSRF-guarded request: every hop DNS-resolved, all addresses must be public, socket pinned to the checked IP. */
export async function safeFetch(req: SafeHttpRequest): Promise<SafeHttpResponse> {
  const deadline = Date.now() + TIMEOUT_MS;
  let current = { ...req };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await once(current, deadline);
    if (result.response) return result.response;
    const next = new URL(result.location!);
    const sameOrigin = next.origin === new URL(current.url).origin;
    const headers = { ...current.headers };
    // Never forward credentials across origins.
    if (!sameOrigin) for (const key of Object.keys(headers)) delete headers[key];
    const toGet = result.status === 303 || ((result.status === 301 || result.status === 302) && (current.method ?? "GET").toUpperCase() === "POST");
    current = { url: next.toString(), method: toGet ? "GET" : current.method, headers, body: toGet ? undefined : current.body };
  }
  throw new Error("errors.httpTooManyRedirects");
}
