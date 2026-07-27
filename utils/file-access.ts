const FILE_ACCESS_PREFIX = "file-access:";
export const FILE_ACCESS_TTL_SECONDS = 30 * 60;

export interface FileAccessGrant {
  key: string;
  host: string;
  expiresAt: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createFileAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function createFileAccessGrant(
  kv: KVNamespace,
  key: string,
  host: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = createFileAccessToken();
  const expiresAt = Date.now() + FILE_ACCESS_TTL_SECONDS * 1000;
  const grant: FileAccessGrant = { key, host, expiresAt };

  await kv.put(`${FILE_ACCESS_PREFIX}${token}`, JSON.stringify(grant), {
    expirationTtl: FILE_ACCESS_TTL_SECONDS,
  });

  return { token, expiresAt };
}

export async function validateFileAccessGrant(
  kv: KVNamespace,
  token: string | null,
  key: string,
  host: string,
): Promise<boolean> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;

  const stored = await kv.get(`${FILE_ACCESS_PREFIX}${token}`);
  if (!stored) return false;

  try {
    const grant: FileAccessGrant = JSON.parse(stored);
    return grant.key === key && grant.host === host && grant.expiresAt > Date.now();
  } catch {
    return false;
  }
}
