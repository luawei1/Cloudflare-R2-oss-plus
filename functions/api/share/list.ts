import { ShareData } from "@/utils/share";
import { addShareToIndex, getShareIdsForFile, removeShareFromIndex } from "@/utils/share-index";
import { decodeBasicAuth } from "@/utils/auth";

interface Env {
  ossShares: KVNamespace;
  [key: string]: any;
}

function toShareSummary(share: ShareData, origin: string) {
  return {
    id: share.id,
    key: share.key,
    url: `${origin}/s/${share.id}`,
    fileName: share.fileName,
    fileSize: share.fileSize,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    hasPassword: !!share.password,
    maxDownloads: share.maxDownloads || null,
    downloads: share.downloads,
    createdBy: share.createdBy,
    host: share.host || null,
    trackDownloads: !!share.trackDownloads,
    allowPreview: share.allowPreview !== false,
    downloadRecords: share.downloadRecords || [],
  };
}

function canManageShare(share: ShareData, username: string, isAdmin: boolean): boolean {
  return isAdmin || share.createdBy === username;
}

// GET - 列出当前用户的分享；可通过 ?key= 精确查询单个文件。
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const headers = new Headers(context.request.headers);
  const credentials = decodeBasicAuth(headers.get("Authorization") || "");
  if (!credentials) {
    return new Response(JSON.stringify({ error: "需要登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const requestUrl = new URL(context.request.url);
    const currentHost = requestUrl.hostname;
    const currentDriveId = currentHost.replace(/\..*/, "");
    const requestedKey = requestUrl.searchParams.get("key");
    const { username, account } = credentials;
    const permissions = String(context.env[account] || "").split(",").map((item: string) => item.trim());
    const isAdmin = permissions.includes("*");
    const now = Date.now();
    const shares: ShareData[] = [];

    let shareIds = requestedKey
      ? await getShareIdsForFile(context.env.ossShares, currentHost, requestedKey)
      : [];

    // 兼容索引上线前创建的分享：按需扫描、回填索引。全量管理页也沿用扫描。
    if (!requestedKey || shareIds.length === 0) {
      const list = await context.env.ossShares.list({ prefix: "share:" });
      shareIds = list.keys.map((item) => item.name.slice("share:".length));
    }

    for (const id of [...new Set(shareIds)]) {
      const shareJson = await context.env.ossShares.get(`share:${id}`);
      if (!shareJson) continue;

      try {
        const share: ShareData = JSON.parse(shareJson);
        if (share.host && share.host !== currentHost) continue;
        if (!share.host && share.driveId && share.driveId !== currentDriveId) continue;
        if (requestedKey && share.key !== requestedKey) continue;
        if (!canManageShare(share, username, isAdmin)) continue;

        if (share.expiresAt && now > share.expiresAt) {
          await context.env.ossShares.delete(`share:${share.id}`);
          await removeShareFromIndex(context.env.ossShares, share);
          continue;
        }

        shares.push(share);
        if (requestedKey) {
          await addShareToIndex(context.env.ossShares, share);
        }
      } catch {
        continue;
      }
    }

    shares.sort((a, b) => b.createdAt - a.createdAt);
    return new Response(JSON.stringify({
      shares: shares.map((share) => toShareSummary(share, requestUrl.origin)),
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("List shares error:", error);
    return new Response(JSON.stringify({ error: "获取分享列表失败" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
