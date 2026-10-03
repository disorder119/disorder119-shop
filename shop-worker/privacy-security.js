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
