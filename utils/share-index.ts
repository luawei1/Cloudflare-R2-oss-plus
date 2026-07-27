import { ShareData } from "@/utils/share";

const SHARE_INDEX_PREFIX = "share-index:";

function getIndexKey(host: string, key: string): string {
  return `${SHARE_INDEX_PREFIX}${host}:${encodeURIComponent(key)}`;
}

export async function addShareToIndex(kv: KVNamespace, share: ShareData): Promise<void> {
  const indexKey = getIndexKey(share.host || "", share.key);
  const stored = await kv.get(indexKey);
  const shareIds: string[] = stored ? JSON.parse(stored) : [];
  if (!shareIds.includes(share.id)) shareIds.push(share.id);

  // 一个文件可同时有永久和短期分享，索引不能跟随任一短期记录过期。
  // 无效 ID 会在下次查询、过期检查或撤销时被清理。
  await kv.put(indexKey, JSON.stringify(shareIds));
}

export async function removeShareFromIndex(kv: KVNamespace, share: ShareData): Promise<void> {
  const indexKey = getIndexKey(share.host || "", share.key);
  const stored = await kv.get(indexKey);
  if (!stored) return;

  const shareIds: string[] = JSON.parse(stored).filter((id: string) => id !== share.id);
  if (shareIds.length) {
    await kv.put(indexKey, JSON.stringify(shareIds));
  } else {
    await kv.delete(indexKey);
  }
}

export async function getShareIdsForFile(kv: KVNamespace, host: string, key: string): Promise<string[]> {
  const stored = await kv.get(getIndexKey(host, key));
  if (!stored) return [];
  try {
    const ids = JSON.parse(stored);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
