import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}
if (!globalThis.atob) {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
}
if (!globalThis.btoa) {
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

const remoteImport = await import("../.tmp-test/utils/remote-import.js");

async function runCase(name, fn) {
  await fn();
  console.log(`  ok - ${name}`);
}

function readStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  return (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    return { chunks, total };
  })();
}

export async function run() {
  await runCase("validateRemoteUrl 拒绝非 HTTP/HTTPS", async () => {
    assert.throws(() => remoteImport.validateRemoteUrl("ftp://example.com/file"), /HTTP 或 HTTPS/);
    assert.throws(() => remoteImport.validateRemoteUrl("not a url"), /链接格式无效/);
  });

  await runCase("validateRemoteUrl 拒绝 userinfo", async () => {
    assert.throws(() => remoteImport.validateRemoteUrl("https://user:pass@example.com/file"), /用户名或密码/);
  });

  await runCase("validateRemoteUrl 拒绝 localhost 和私有 IP", async () => {
    assert.throws(() => remoteImport.validateRemoteUrl("https://localhost/file"), /本地或私有网络/);
    assert.throws(() => remoteImport.validateRemoteUrl("https://127.0.0.1/file"), /本地或私有网络/);
    assert.throws(() => remoteImport.validateRemoteUrl("https://192.168.1.1/file"), /本地或私有网络/);
    assert.throws(() => remoteImport.validateRemoteUrl("https://[::1]/file"), /本地或私有网络/);
  });

  await runCase("validateRemoteUrl 接受公开 HTTPS 直链", async () => {
    const url = remoteImport.validateRemoteUrl("https://downloads.example.com/release.zip");
    assert.equal(url.hostname, "downloads.example.com");
  });

  await runCase("buildRemoteImportKey 拒绝路径穿越", async () => {
    assert.throws(() => remoteImport.buildRemoteImportKey("../etc", "passwd"), /目标目录/);
    assert.throws(() => remoteImport.buildRemoteImportKey("", ".."), /目标文件名/);
    assert.throws(() => remoteImport.buildRemoteImportKey("", "a/b"), /目标文件名/);
  });

  await runCase("buildRemoteImportKey 拒绝系统目录前缀", async () => {
    assert.throws(() => remoteImport.buildRemoteImportKey("_$flaredrive$", "thumbnails"), /系统目录/);
  });

  await runCase("buildRemoteImportKey 组合目录与文件名", async () => {
    assert.equal(remoteImport.buildRemoteImportKey("Videos/2026", "demo.mp4"), "Videos/2026/demo.mp4");
    assert.equal(remoteImport.buildRemoteImportKey("", "root.txt"), "root.txt");
    assert.equal(remoteImport.buildRemoteImportKey("Downloads/", "file.zip"), "Downloads/file.zip");
  });

  await runCase("parseContentLength 仅接受数字", async () => {
    assert.equal(remoteImport.parseContentLength("12345"), 12345);
    assert.equal(remoteImport.parseContentLength(null), null);
    assert.equal(remoteImport.parseContentLength("abc"), null);
  });

  await runCase("deriveRemoteFileName 优先 Content-Disposition", async () => {
    const url = new URL("https://example.com/path/download?token=abc");
    const name = remoteImport.deriveRemoteFileName(url, 'attachment; filename="报告.pdf"; size=123');
    assert.equal(name, "报告.pdf");
  });

  await runCase("deriveRemoteFileName 回退到 URL 路径段", async () => {
    const url = new URL("https://example.com/files/release%20file.zip");
    const name = remoteImport.deriveRemoteFileName(url, null);
    assert.equal(name, "release file.zip");
  });

  await runCase("createByteLimitedStream 在限额内完整传递", async () => {
    const source = new Response(new Uint8Array(2048)).body;
    const limited = remoteImport.createByteLimitedStream(source);
    const { total } = await readStream(limited.stream);
    assert.equal(total, 2048);
    assert.equal(limited.getBytesRead(), 2048);
  });

  await runCase("createByteLimitedStream 超限时中止并报错", async () => {
    const overflow = new Uint8Array(remoteImport.REMOTE_IMPORT_MAX_BYTES + 1024);
    const source = new Response(overflow).body;
    const limited = remoteImport.createByteLimitedStream(source);
    await assert.rejects(() => readStream(limited.stream), /REMOTE_IMPORT_SIZE_LIMIT/);
    assert.ok(limited.getBytesRead() > remoteImport.REMOTE_IMPORT_MAX_BYTES);
  });
}
