import assert from "node:assert/strict";

const shareMove = await import("../.tmp-test/utils/share-move.js");

async function runCase(name, fn) {
  await fn();
  console.log(`  ok - ${name}`);
}

class MemoryKV {
  constructor() {
    this.map = new Map();
  }
  async put(key, value) {
    this.map.set(key, value);
  }
  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  async delete(key) {
    this.map.delete(key);
  }
  async list({ prefix = "" } = {}) {
    return {
      keys: [...this.map.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
    };
  }
}

const HOST = "pan.ruoc.kdns.fr";

function makeShare(overrides) {
  return {
    id: "abc12345",
    key: "Docs/报告.pdf",
    fileName: "报告.pdf",
    fileSize: 1024,
    createdAt: 1_700_000_000_000,
    expiresAt: null,
    downloads: 0,
    createdBy: "alice",
    host: HOST,
    ...overrides,
  };
}

function identifier(host, key) {
  return `share-index:${host}:${encodeURIComponent(key)}`;
}

function shareRecord(id) {
  return `share:${id}`;
}

export async function run() {
  await runCase("mapMovedShareKey 替换文件自身路径", async () => {
    assert.equal(
      shareMove.mapMovedShareKey("Docs/报告.pdf", "Docs/最终.pdf", "Docs/报告.pdf"),
      "Docs/最终.pdf"
    );
  });

  await runCase("mapMovedShareKey 迁移文件夹子路径并保留相对位置", async () => {
    assert.equal(
      shareMove.mapMovedShareKey("Docs/", "Archive/", "Docs/子目录/demo.txt"),
      "Archive/子目录/demo.txt"
    );
  });

  await runCase("mapMovedShareKey 不影响无关路径", async () => {
    assert.equal(shareMove.mapMovedShareKey("Docs/", "Archive/", "Docs2/x.txt"), null);
    assert.equal(shareMove.mapMovedShareKey("a/b.txt", "a/c.txt", "a/b.txt.bak"), null);
  });

  await runCase("validateMoveKeys 拒绝系统目录与路径穿越", async () => {
    assert.throws(() => shareMove.validateMoveKeys("a", "_$flaredrive$/x"), /系统目录/);
    assert.throws(() => shareMove.validateMoveKeys("a", "../x"), /无效/);
    assert.throws(() => shareMove.validateMoveKeys("a", "/abs"), /\/ 开头/);
    assert.throws(() => shareMove.validateMoveKeys("", "b"), /不能为空/);
  });

  await runCase("buildUpdatedShare 同步文件名", async () => {
    const updated = shareMove.buildUpdatedShare(makeShare(), "Docs/最终.pdf");
    assert.equal(updated.key, "Docs/最终.pdf");
    assert.equal(updated.fileName, "最终.pdf");
    assert.equal(updated.createdBy, "alice");
  });

  await runCase("migrateShares 迁移同一文件的全部分享并更新索引", async () => {
    const kv = new MemoryKV();
    const first = makeShare({ id: "aaa11111" });
    const second = makeShare({ id: "bbb22222", createdBy: "bob" });
    await kv.put(shareRecord("aaa11111"), JSON.stringify(first));
    await kv.put(shareRecord("bbb22222"), JSON.stringify(second));
    await kv.put(identifier(HOST, first.key), JSON.stringify(["aaa11111", "bbb22222"]));

    const migrated = await shareMove.migrateShares(kv, "Docs/报告.pdf", "Docs/最终.pdf");
    assert.equal(migrated, 2);

    const updatedFirst = JSON.parse(await kv.get(shareRecord("aaa11111")));
    const updatedSecond = JSON.parse(await kv.get(shareRecord("bbb22222")));
    assert.equal(updatedFirst.key, "Docs/最终.pdf");
    assert.equal(updatedFirst.fileName, "最终.pdf");
    assert.equal(updatedSecond.key, "Docs/最终.pdf");

    assert.equal(await kv.get(identifier(HOST, "Docs/报告.pdf")), null);
    const newIndex = JSON.parse(await kv.get(identifier(HOST, "Docs/最终.pdf")));
    assert.deepEqual(newIndex.sort(), ["aaa11111", "bbb22222"]);
  });

  await runCase("migrateShares 文件夹迁移保留相对路径", async () => {
    const kv = new MemoryKV();
    const child = makeShare({ id: "ccc33333", key: "Docs/子目录/demo.txt", fileName: "demo.txt" });
    const rootMarker = makeShare({ id: "ddd44444", key: "Docs/_$folder$", fileName: "_$folder$" });
    await kv.put(shareRecord("ccc33333"), JSON.stringify(child));
    await kv.put(shareRecord("ddd44444"), JSON.stringify(rootMarker));

    const migrated = await shareMove.migrateShares(kv, "Docs/", "Archive/");
    assert.equal(migrated, 2);

    const updatedChild = JSON.parse(await kv.get(shareRecord("ccc33333")));
    const updatedMarker = JSON.parse(await kv.get(shareRecord("ddd44444")));
    assert.equal(updatedChild.key, "Archive/子目录/demo.txt");
    assert.equal(updatedMarker.key, "Archive/_$folder$");
  });

  await runCase("migrateShares 跳过无关联分享", async () => {
    const kv = new MemoryKV();
    await kv.put(shareRecord("eee55555"), JSON.stringify(makeShare({ id: "eee55555", key: "other.txt" })));
    const migrated = await shareMove.migrateShares(kv, "Docs/报告.pdf", "Docs/最终.pdf");
    assert.equal(migrated, 0);
  });
}
