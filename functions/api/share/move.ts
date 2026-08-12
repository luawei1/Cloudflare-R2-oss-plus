import { parseBucketPath } from "@/utils/bucket";
import { getWriteAuthStatusForPathAsync } from "@/utils/auth";
import { buildUpdatedShare, mapMovedShareKey, migrateShares, validateMoveKeys } from "@/utils/share-move";

interface Env {
  ossShares: KVNamespace;
  [key: string]: any;
}

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { oldKey?: string; newKey?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "请求内容必须为 JSON" }, 400);
  }

  try {
    const oldKey = String(body.oldKey || "").trim();
    const newKey = String(body.newKey || "").trim();
    validateMoveKeys(oldKey, newKey);
    if (oldKey === newKey) return json({ success: true, migrated: 0 });

    if (!(await getWriteAuthStatusForPathAsync(context, newKey))) {
      return json({ error: "没有向目标路径写入文件的权限" }, 403);
    }

    const [bucket] = await parseBucketPath(context);
    if (!bucket || typeof bucket.head !== "function") {
      return json({ error: "存储桶未配置" }, 500);
    }

    const isFolderMove = oldKey.endsWith("/") || newKey.endsWith("/");
    const headKey = isFolderMove
      ? `${newKey.replace(/\/+$/, "")}/_$folder$`
      : newKey;
    try {
      const exists = await bucket.head(headKey);
      if (!exists) {
        return json({ error: "目标文件或文件夹不存在" }, 404);
      }
    } catch {
      return json({ error: "目标文件或文件夹不存在" }, 404);
    }

    const migrated = await migrateShares(context.env.ossShares, oldKey, newKey);
    return json({ success: true, migrated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "迁移分享失败";
    return json({ error: message }, 400);
  }
};
