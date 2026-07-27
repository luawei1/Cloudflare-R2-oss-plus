import { notFound, parseBucketPath } from "@/utils/bucket";
import { createFileAccessGrant } from "@/utils/file-access";
import { extractApiKeyFromHeaders, getGuestDirs, decodeBasicAuth, THUMBNAILS_PATH } from "@/utils/auth";

interface Env {
  ossShares: KVNamespace;
  [key: string]: any;
}

async function getAllowedPaths(env: Env, headers: Headers): Promise<{ isAuthenticated: boolean; isAdmin: boolean; allowedPaths: string[] }> {
  const apiKey = extractApiKeyFromHeaders(headers);
  if (apiKey) {
    const { validateApiKey } = await import("@/utils/apikey");
    const result = await validateApiKey(env.ossShares, apiKey);
    if (result.valid && result.apiKey) {
      const isAdmin = result.apiKey.permissions.includes("*");
      return {
        isAuthenticated: true,
        isAdmin,
        allowedPaths: isAdmin
          ? []
          : result.apiKey.permissions.filter((path: string) => path !== "*").map((path: string) => path.replace(/^\//, "").replace(/\/$/, "")),
      };
    }
  }

  const credentials = decodeBasicAuth(headers.get("Authorization") || "");
  if (!credentials || !env[credentials.account]) {
    return { isAuthenticated: false, isAdmin: false, allowedPaths: getGuestDirs(env) };
  }

  const permissions = env[credentials.account].split(",").map((path: string) => path.trim()).filter(Boolean);
  const isAdmin = permissions.includes("*");
  return {
    isAuthenticated: true,
    isAdmin,
    allowedPaths: isAdmin ? [] : permissions.filter((path: string) => path !== "readonly" && path.startsWith("/")).map((path: string) => path.replace(/^\//, "")),
  };
}

function isFileAllowed(key: string, allowedPaths: string[], isAdmin: boolean): boolean {
  if (isAdmin || key.startsWith(THUMBNAILS_PATH)) return true;
  const normalizedKey = key.replace(/\/+$/, "");
  return allowedPaths.some((path) => {
    const normalizedPath = path.replace(/\/+$/, "");
    return normalizedKey === normalizedPath || normalizedKey.startsWith(`${normalizedPath}/`);
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let key: string;
  try {
    [, key] = await parseBucketPath(context);
  } catch (error) {
    console.error("file access path error:", error);
    return new Response(JSON.stringify({ error: "存储配置错误" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  if (!key) return notFound();

  const headers = new Headers(context.request.headers);
  const access = await getAllowedPaths(context.env, headers);
  if (!access.isAuthenticated || !isFileAllowed(key, access.allowedPaths, access.isAdmin)) {
    return new Response(JSON.stringify({ error: "无权访问此文件" }), { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  const host = new URL(context.request.url).hostname;
  const { token, expiresAt } = await createFileAccessGrant(context.env.ossShares, key, host);
  const encodedPath = key.split("/").map(encodeURIComponent).join("/");

  return new Response(JSON.stringify({
    url: `/raw/${encodedPath}?access=${encodeURIComponent(token)}`,
    expiresAt,
  }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
