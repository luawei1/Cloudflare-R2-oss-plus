export const REMOTE_IMPORT_MAX_BYTES = 200 * 1024 * 1024;

const INVALID_FILE_NAME = /[\0/\\]/;
const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^224\./,
  /^2(?:2[4-9]|3\d)\./,
];

function isPrivateIpv4(hostname: string): boolean {
  if (PRIVATE_IPV4.some((pattern) => pattern.test(hostname))) return true;
  const match = /^172\.(\d+)\./.exec(hostname);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export function validateRemoteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("链接格式无效");
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("仅支持 HTTP 或 HTTPS 直链");
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error("链接不能包含用户名或密码");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new Error("不允许访问本地或私有网络地址");
  }
  return url;
}

export function buildRemoteImportKey(targetDir: string, fileName: string): string {
  const normalizedDir = String(targetDir || '').replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const normalizedName = String(fileName || '').trim();
  if (!normalizedName || INVALID_FILE_NAME.test(normalizedName) || normalizedName === '.' || normalizedName === '..' || normalizedName.includes('..')) {
    throw new Error("目标文件名无效");
  }
  if (normalizedDir && normalizedDir.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error("目标目录无效");
  }
  const key = `${normalizedDir}${normalizedDir && !normalizedDir.endsWith('/') ? '/' : ''}${normalizedName}`;
  if (key.startsWith('_$flaredrive$/')) throw new Error("不能写入系统目录");
  return key;
}

function decodeContentDispositionFileName(value: string | null): string | null {
  if (!value) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (extended) {
    try { return decodeURIComponent(extended); } catch { return null; }
  }
  const basic = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return basic ? basic.trim() : null;
}

export function deriveRemoteFileName(sourceUrl: URL, contentDisposition: string | null): string {
  const fromHeader = decodeContentDispositionFileName(contentDisposition);
  if (fromHeader && !INVALID_FILE_NAME.test(fromHeader)) return fromHeader;
  const segment = sourceUrl.pathname.split('/').filter(Boolean).pop();
  if (segment) {
    try {
      const decoded = decodeURIComponent(segment);
      if (!INVALID_FILE_NAME.test(decoded)) return decoded;
    } catch { /* fall through */ }
  }
  return `imported-file-${Date.now()}`;
}

export function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : null;
}

export function createByteLimitedStream(source: ReadableStream<Uint8Array>, maxBytes = REMOTE_IMPORT_MAX_BYTES): {
  stream: ReadableStream<Uint8Array>;
  getBytesRead: () => number;
} {
  let bytesRead = 0;
  const reader = source.getReader();
  return {
    getBytesRead: () => bytesRead,
    stream: new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          await reader.cancel("REMOTE_IMPORT_SIZE_LIMIT");
          controller.error(new Error("REMOTE_IMPORT_SIZE_LIMIT"));
          return;
        }
        controller.enqueue(value);
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    }),
  };
}
