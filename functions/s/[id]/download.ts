import { ShareData, DownloadRecord } from "@/utils/share";
import { hasSharePreviewSession } from "@/utils/share-session";
import { parseBucketPath } from "@/utils/bucket";

interface Env {
  BUCKET: R2Bucket;
  ossShares: KVNamespace;
}

// GET - 直接下载（供分享页完成验证后使用）
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const shareId = context.params.id as string;
  const url = new URL(context.request.url);

  try {
    const shareJson = await context.env.ossShares.get(`share:${shareId}`);
    if (!shareJson) {
      return new Response('分享不存在或已过期', { status: 404 });
    }

    const share: ShareData = JSON.parse(shareJson);

    // 多后端场景：确保在创建分享时的域名下访问
    if (share.host && share.host !== url.hostname) {
      const target = new URL(url.toString());
      target.hostname = share.host;
      return Response.redirect(target.toString(), 302);
    }

    // 检查是否过期
    if (share.expiresAt && Date.now() > share.expiresAt) {
      await context.env.ossShares.delete(`share:${shareId}`);
      return new Response('分享已过期', { status: 410 });
    }

    // 检查下载次数
    if (share.maxDownloads && share.downloads >= share.maxDownloads) {
      return new Response('已达到最大下载次数', { status: 410 });
    }

    // 密码分享只能在分享页面验证后使用短时 HttpOnly 会话下载。
    if (share.password && !(await hasSharePreviewSession(
      context.env.ossShares,
      context.request.headers.get('Cookie'),
      shareId,
      url.hostname,
    ))) {
      return new Response('需要密码，请先通过分享页面验证', { status: 401 });
    }

    const range = context.request.headers.get('Range');
    // 仅首次请求（无 Range 头）才计数和写记录，续传请求不消耗下载额度。
    if (!range) {
      share.downloads++;

      if (share.trackDownloads) {
        const clientIP = context.request.headers.get('CF-Connecting-IP')
          || context.request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
          || context.request.headers.get('X-Real-IP')
          || 'unknown';
        const userAgent = context.request.headers.get('User-Agent') || undefined;

        const downloadRecord: DownloadRecord = {
          ip: clientIP,
          time: Date.now(),
          userAgent: userAgent,
        };

        if (!share.downloadRecords) {
          share.downloadRecords = [];
        }
        if (share.downloadRecords.length >= 100) {
          share.downloadRecords.shift();
        }
        share.downloadRecords.push(downloadRecord);
      }

      const ttl = share.expiresAt ? Math.floor((share.expiresAt - Date.now()) / 1000) : undefined;
      const kvOptions: KVNamespacePutOptions = {};
      if (ttl && ttl > 0) {
        kvOptions.expirationTtl = ttl;
      }
      await context.env.ossShares.put(`share:${shareId}`, JSON.stringify(share), kvOptions);
    }

    // 获取文件
    const [bucket] = await parseBucketPath(context);
    if (!bucket) return new Response('存储桶未配置', { status: 500 });

    // S3/OneDrive 后端：转发 Range 给源站并透传响应
    if (typeof bucket.fetchObject === "function") {
      const headers = new Headers();
      if (range) headers.set("Range", range);
      const response = await bucket.fetchObject(share.key, { method: "GET", headers });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(share.fileName)}`);
      responseHeaders.set('Accept-Ranges', 'bytes');
      responseHeaders.set('Cache-Control', 'private, no-store');
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
    }

    if (typeof bucket.get !== "function") return new Response('存储桶未配置', { status: 500 });

    // R2 后端：用 bucket.get 的 range 选项取分片
    let object;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response("无效的 Range 请求", { status: 416 });
      const offset = Number(match[1]);
      const end = match[2] ? Number(match[2]) : undefined;
      const length = end === undefined ? undefined as any : end - offset + 1;
      object = await bucket.get(share.key, { range: length ? { offset, length } : { offset } });
    } else {
      object = await bucket.get(share.key);
    }

    if (!object) {
      return new Response('文件已被移动或删除，请联系分享者', { status: 410 });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(share.fileName)}`);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Access-Control-Allow-Origin', '*');

    if (range && object.range) {
      const end = object.range.offset + object.range.length - 1;
      headers.set('Content-Range', `bytes ${object.range.offset}-${end}/${object.size}`);
      headers.set('Content-Length', object.range.length.toString());
      return new Response(object.body, { status: 206, headers });
    }

    headers.set('Content-Length', object.size.toString());
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Download error:', error);
    return new Response('下载失败', { status: 500 });
  }
};
