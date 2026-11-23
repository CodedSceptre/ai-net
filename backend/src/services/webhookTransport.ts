import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const nonPublic = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) {
  nonPublic.addSubnet(network, prefix, "ipv4");
}
nonPublic.addSubnet("2001::", 23, "ipv6");
nonPublic.addSubnet("2001:db8::", 32, "ipv6");
nonPublic.addSubnet("2002::", 16, "ipv6");
nonPublic.addSubnet("3fff::", 20, "ipv6");
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");

function isPublic(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublic.check(address, "ipv4");
  return family === 6 && globalIPv6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
}

export function parseWebhookUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port && url.port !== "443") || (isIP(hostname) && !isPublic(hostname))) {
    throw new Error("A public HTTPS webhook URL is required");
  }
  return url;
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function postWebhook(value: string, secret: string, body: string): Promise<number> {
  const url = parseWebhookUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const signal = AbortSignal.timeout(8_000);
  // Pin the validated address for the socket while retaining the original TLS identity.
  const addresses = await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
  const target = addresses[0];
  if (!target || addresses.some(({ address }) => !isPublic(address)) || signal.aborted) {
    throw new Error("Webhook host did not resolve to a public address");
  }

  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      family: target.family,
      lookup: (_name, _options, callback) => callback(null, target.address, target.family),
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Hub-Signature-256": signWebhookBody(secret, body),
      },
    }, (res) => {
      const code = res.statusCode ?? 0;
      res.destroy();
      resolve(code);
    });
    req.on("error", reject);
    req.end(body);
  });
}
