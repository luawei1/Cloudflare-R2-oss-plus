const SHARE_PREVIEW_SESSION_PREFIX = "share-preview-session:";
const SHARE_PREVIEW_COOKIE_PREFIX = "share_preview_";
export const SHARE_PREVIEW_SESSION_TTL_SECONDS = 30 * 60;

interface SharePreviewSession {
  shareId: string;
  host: string;
  expiresAt: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }

  return null;
}

export async function createSharePreviewSession(
  kv: KVNamespace,
  shareId: string,
  host: string,
  shareExpiresAt: number | null,
): Promise<string> {
  const remainingSeconds = shareExpiresAt
    ? Math.floor((shareExpiresAt - Date.now()) / 1000)
    : SHARE_PREVIEW_SESSION_TTL_SECONDS;
  const ttl = Math.min(SHARE_PREVIEW_SESSION_TTL_SECONDS, remainingSeconds);

  if (ttl <= 0) throw new Error("分享已过期");

  const token = createSessionToken();
  const session: SharePreviewSession = {
    shareId,
    host,
    expiresAt: Date.now() + ttl * 1000,
  };

  await kv.put(`${SHARE_PREVIEW_SESSION_PREFIX}${token}`, JSON.stringify(session), {
    expirationTtl: ttl,
  });

  return `${SHARE_PREVIEW_COOKIE_PREFIX}${shareId}=${token}; Path=/s/${encodeURIComponent(shareId)}; Max-Age=${ttl}; HttpOnly; Secure; SameSite=Lax`;
}

export async function hasSharePreviewSession(
  kv: KVNamespace,
  cookieHeader: string | null,
  shareId: string,
  host: string,
): Promise<boolean> {
  const token = getCookieValue(cookieHeader, `${SHARE_PREVIEW_COOKIE_PREFIX}${shareId}`);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;

  const stored = await kv.get(`${SHARE_PREVIEW_SESSION_PREFIX}${token}`);
  if (!stored) return false;

  try {
    const session: SharePreviewSession = JSON.parse(stored);
    return session.shareId === shareId && session.host === host && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}
