import { createHmac, timingSafeEqual } from "node:crypto";

export const HMAC_KEY_ENV = "SITE_HMAC_KEY";
export const PASSWORD_HMAC_ENV = "SITE_PASSWORD_HMAC";
export const GATE_COOKIE = "jev_gate";

const SESSION_SECONDS = 60 * 60 * 24 * 7;

function trimmed(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function gateConfigured(): boolean {
  return Boolean(trimmed(HMAC_KEY_ENV) && trimmed(PASSWORD_HMAC_ENV));
}

function mac(key: string, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function passwordMatches(password: string): boolean {
  const key = trimmed(HMAC_KEY_ENV);
  const expected = trimmed(PASSWORD_HMAC_ENV)?.toLowerCase();
  if (!key || !expected) return false;
  const actual = mac(key, password);
  return equalHex(actual, expected);
}

export function signSession(now = Date.now()): string | null {
  const key = trimmed(HMAC_KEY_ENV);
  if (!key) return null;
  const exp = Math.floor(now / 1000) + SESSION_SECONDS;
  return `${exp}.${mac(key, `allow:${exp}`)}`;
}

export function sessionValid(cookie: string | undefined, now = Date.now()): boolean {
  const key = trimmed(HMAC_KEY_ENV);
  if (!key || !cookie) return false;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return false;
  const expStr = cookie.slice(0, dot);
  const given = cookie.slice(dot + 1).toLowerCase();
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  return equalHex(mac(key, `allow:${expStr}`), given);
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmedPart = part.trim();
    if (!trimmedPart.startsWith(`${name}=`)) continue;
    return decodeURIComponent(trimmedPart.slice(name.length + 1));
  }
  return undefined;
}

export function sessionCookie(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}
