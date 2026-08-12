import { ShareData } from "./share";
import { addShareToIndex, removeShareFromIndex } from "./share-index";

const INTERNAL_PREFIX = "_$flaredrive$/";

export function validateMoveKeys(oldKey: string, newKey: string): void {
  for (const [name, value] of [["oldKey", oldKey], ["newKey", newKey]]) {
    if (!value) throw new Error(`${name} 不能为空`);
    if (value.includes("\0") || value.includes("..")) throw new Error(`${name} 无效`);
    if (value.startsWith("/")) throw new Error(`${name} 不能以 / 开头`);
  }
  if (newKey.startsWith(INTERNAL_PREFIX)) throw new Error("不能迁移到系统目录");
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function mapMovedShareKey(oldKey: string, newKey: string, currentKey: string): string | null {
  const normalizedOld = withoutTrailingSlash(oldKey);
  const normalizedNew = withoutTrailingSlash(newKey);

  if (currentKey === normalizedOld || currentKey === normalizedOld + "/") {
    // 对象自身（文件或文件夹标记）
    return currentKey.endsWith("/") ? normalizedNew + "/" : normalizedNew;
  }
  if (currentKey.startsWith(normalizedOld + "/")) {
    return normalizedNew + currentKey.slice(normalizedOld.length);
  }
  return null;
}

function ttlFor(share: ShareData): KVNamespacePutOptions | undefined {
  if (!share.expiresAt) return undefined;
  const ttl = Math.floor((share.expiresAt - Date.now()) / 1000);
  return ttl > 0 ? { expirationTtl: ttl } : undefined;
}

export function buildUpdatedShare(share: ShareData, newKey: string): ShareData {
  const updated: ShareData = { ...share, key: newKey };
  const oldName = share.key.split("/").filter(Boolean).pop() || "";
  const newName = newKey.split("/").filter(Boolean).pop() || "";
  if (oldName && newName) updated.fileName = newName;
  return updated;
}

/**
 * 将指向 oldKey（含其子路径）的所有分享迁移到 newKey。
 * 返回迁移条数；单条记录解析失败时跳过并继续。
 */
export async function migrateShares(
  kv: KVNamespace,
  oldKey: string,
  newKey: string,
): Promise<number> {
  const list = await kv.list({ prefix: "share:" });
  let migrated = 0;

  for (const item of list.keys) {
    const raw = await kv.get(item.name);
    if (!raw) continue;

    let share: ShareData;
    try {
      share = JSON.parse(raw);
    } catch {
      continue;
    }

    const mapped = mapMovedShareKey(oldKey, newKey, share.key);
    if (!mapped || mapped === share.key) continue;

    await removeShareFromIndex(kv, share);
    const updated = buildUpdatedShare(share, mapped);
    await kv.put(item.name, JSON.stringify(updated), ttlFor(updated));
    await addShareToIndex(kv, updated);
    migrated += 1;
  }

  return migrated;
}
