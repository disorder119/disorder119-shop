// Abuse-prevention identifiers remain personal data (pseudonymisation).
// A public fallback is permitted only in an explicitly non-live test setup.
export function ipPepper(env = {}) {
  const pepper = String(env.LOGIN_IP_PEPPER || "");
  if (pepper.length >= 32) return pepper;
  if (String(env.PAYPAL_ENVIRONMENT || "").toLowerCase() === "live") {
    const error = new Error("IP_PRIVACY_NOT_CONFIGURED");
    error.code = "IP_PRIVACY_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  return "local-test-only-no-production-identifier";
}

export async function privateIpHash(request, env, purpose) {
  const pepper = ipPepper(env);
  const ip = String(request.headers.get("CF-Connecting-IP") || "").slice(0, 60);
  if (!ip) return null;
  const bytes = new TextEncoder().encode(`${purpose}:${ip}:${pepper}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

// Ein Anschluss statt einer einzelnen Adresse: IPv6-Kunden bekommen meist ein
// ganzes /64-Netz und koennten sonst mit jeder Anfrage eine neue Adresse
// nehmen. IPv4 bleibt, wie es ist (auch als ::ffff:a.b.c.d).
export function anschlussVonIp(value) {
  const ip = String(value || "").trim().toLowerCase().split("%")[0].slice(0, 60);
  if (!ip.includes(":")) return ip;
  const v4 = ip.match(/^(?:0{0,4}:){0,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  const teile = ip.split("::");
  if (teile.length > 2) return ip;
  const links = teile[0] ? teile[0].split(":") : [];
  const rechts = teile.length === 2 && teile[1] ? teile[1].split(":") : [];
  const gruppen = teile.length === 2
    ? [...links, ...Array(Math.max(0, 8 - links.length - rechts.length)).fill("0"), ...rechts]
    : links;
  if (gruppen.length < 4 || gruppen.some(g => !/^[0-9a-f]{1,4}$/.test(g) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(g))) return ip;
  return `${gruppen.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

// Wie privateIpHash, aber je Anschluss (IPv6: /64). Fuer Grenzen, die ueber
// Stunden und Tage zaehlen (Gutscheine, Mails, offene Bestellungen).
export async function privateNetzHash(request, env, purpose) {
  const pepper = ipPepper(env);
  const netz = anschlussVonIp(request.headers.get("CF-Connecting-IP"));
  if (!netz) return null;
  const bytes = new TextEncoder().encode(`${purpose}:netz:${netz}:${pepper}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
