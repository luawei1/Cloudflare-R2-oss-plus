import { ShareData } from "@/utils/share";
import { hasSharePreviewSession } from "@/utils/share-session";
import { parseBucketPath } from "@/utils/bucket";

interface Env {
  BUCKET: R2Bucket;
  ossShares: KVNamespace;
}

function isMediaFile(fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  return [
    "jpg", "jpeg", "png", "gif", "webp", "avif", "svg",
    "mp4", "webm", "ogg", "mov", "m4v",
    "mp3", "wav", "flac", "m4a", "aac", "oga",
  ].includes(extension);
}

function isPreviewAuthorized(share: ShareData, context: any, host: string): Promise<boolean> | boolean {
  if (!share.password) return true;
  return hasSharePreviewSession(
    context.env.ossShares,
    context.request.headers.get("Cookie"),
    share.id,
    host,
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const shareId = context.params.id as string;
  const requestUrl = new URL(context.request.url);

  try {
    if (!context.env.ossShares) return new Response("分享不可用", { status: 404 });
    const shareJson = await context.env.ossShares.get(`share:${shareId}`);
    if (!shareJson) return new Response("分享不存在或已过期", { status: 404 });

    const share: ShareData = JSON.parse(shareJson);
    if (share.host && share.host !== requestUrl.hostname) {
      const target = new URL(requestUrl.toString());
      target.hostname = share.host;
      return Response.redirect(target.toString(), 302);
    }
    if (share.expiresAt && Date.now() > share.expiresAt) {
      await context.env.ossShares.delete(`share:${shareId}`);
      return new Response("分享已过期", { status: 410 });
    }
    if (share.allowPreview === false) return new Response("此分享未开启预览", { status: 403 });
    if (!isMediaFile(share.fileName)) return new Response("此文件仅支持下载", { status: 403 });
    if (!(await isPreviewAuthorized(share, context, requestUrl.hostname))) {
      return new Response("需要先在分享页面验证密码", { status: 401 });
    }

    const [bucket] = await parseBucketPath(context);
    if (!bucket) return new Response("存储桶未配置", { status: 500 });

    const range = context.request.headers.get("Range");
    if (typeof bucket.fetchObject === "function") {
      const headers = new Headers();
      if (range) headers.set("Range", range);
      const response = await bucket.fetchObject(share.key, { method: "GET", headers });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(share.fileName)}`);
      responseHeaders.set("Cache-Control", "private, no-store");
      responseHeaders.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
    }

    if (typeof bucket.get !== "function") return new Response("存储桶未配置", { status: 500 });
    let object;
    let offset = 0;
    let length = 0;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response("无效的 Range 请求", { status: 416 });
      offset = Number(match[1]);
      const end = match[2] ? Number(match[2]) : undefined;
      length = end === undefined ? undefined as any : end - offset + 1;
      object = await bucket.get(share.key, { range: length ? { offset, length } : { offset } });
    } else {
      object = await bucket.get(share.key);
    }
    if (!object) return new Response("文件不存在", { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(share.fileName)}`);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    if (range && object.range) {
      const end = object.range.offset + object.range.length - 1;
      headers.set("Content-Range", `bytes ${object.range.offset}-${end}/${object.size}`);
      headers.set("Content-Length", object.range.length.toString());
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("Content-Length", object.size.toString());
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("Share preview content error:", error);
    return new Response("预览加载失败", { status: 500 });
  }
};
