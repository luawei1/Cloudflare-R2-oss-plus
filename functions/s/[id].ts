import { ShareData, verifyPassword, formatFileSize } from "@/utils/share";
import { createSharePreviewSession, hasSharePreviewSession } from "@/utils/share-session";

interface Env {
  ossShares: KVNamespace;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getMediaType(fileName: string): "image" | "video" | "audio" | null {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "ogg", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "flac", "m4a", "aac", "oga"].includes(ext)) return "audio";
  return null;
}

function getFileKind(fileName: string): string {
  const ext = fileName.split(".").pop()?.toUpperCase();
  return ext ? `${ext} 文件` : "文件";
}

function metadata(share: ShareData): string {
  const expiresAt = share.expiresAt ? new Date(share.expiresAt).toLocaleString("zh-CN") : "永久有效";
  const downloads = share.maxDownloads ? `${share.maxDownloads - share.downloads} / ${share.maxDownloads}` : "无限制";
  return `<dl><div><dt>大小</dt><dd>${formatFileSize(share.fileSize)}</dd></div><div><dt>有效期</dt><dd>${expiresAt}</dd></div><div><dt>下载额度</dt><dd>${downloads}</dd></div>${share.password ? "<div><dt>访问</dt><dd>密码保护</dd></div>" : ""}</dl>`;
}

function downloadPage(share: ShareData, origin: string, error = "", needsPassword = false): string {
  const safeName = escapeHtml(share.fileName);
  const actionText = needsPassword ? "验证并下载" : "下载文件";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${safeName} - 文件分享</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202b38;background:#edf2f7}body{min-height:100dvh}.shell{min-height:100dvh;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}.card{width:min(100%,560px);background:#fff;border:1px solid #d9e1ea;border-radius:8px;padding:36px;box-shadow:0 18px 42px rgba(31,51,72,.12)}.file-mark{width:54px;height:54px;display:grid;place-items:center;border-radius:7px;background:#eef3f8;color:#f38020;font-weight:800;font-size:12px;margin-bottom:24px}.kind{color:#68788b;font-size:13px;margin:0 0 8px}.name{margin:0;color:#172233;font-size:22px;line-height:1.35;overflow-wrap:anywhere}.intro{margin:12px 0 24px;color:#68788b;font-size:14px}.card dl{margin:0;border-top:1px solid #e4eaf0}.card dl div{display:flex;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid #e4eaf0;font-size:14px}.card dt{color:#68788b}.card dd{margin:0;text-align:right;overflow-wrap:anywhere}.primary{width:100%;min-height:50px;margin-top:28px;display:grid;place-items:center;background:#f38020;color:#fff;text-decoration:none;border:0;border-radius:6px;font-size:15px;font-weight:700;cursor:pointer}.primary:hover{background:#d96d16}.error{margin:0 0 16px;padding:11px 12px;background:#fff0ef;color:#b73229;font-size:14px;border-radius:5px}.password{margin-top:24px}.password label{display:block;margin-bottom:8px;color:#4e5d70;font-size:14px}.password input{width:100%;padding:13px;border:1px solid #b9c5d2;border-radius:5px;font-size:16px}@media(max-width:480px){.shell{align-items:start;padding-top:max(56px,env(safe-area-inset-top))}.card{padding:26px 22px}.name{font-size:20px}.card dl div{display:block}.card dd{text-align:left;margin-top:5px}.primary{min-height:52px}}
</style></head><body><main class="shell"><section class="card"><div class="file-mark">${escapeHtml(getFileKind(share.fileName).replace(" 文件", ""))}</div><p class="kind">${escapeHtml(getFileKind(share.fileName))}</p><h1 class="name">${safeName}</h1><p class="intro">此文件可安全下载到本地查看。</p>${metadata(share)}${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}${needsPassword ? `<form class="password" method="POST"><label for="password">访问密码</label><input id="password" name="password" type="password" required autofocus placeholder="请输入访问密码"><button class="primary" type="submit">${actionText}</button></form>` : `<a class="primary" href="${origin}/s/${encodeURIComponent(share.id)}/download">${actionText}</a>`}</section></main></body></html>`;
}

function mediaPage(share: ShareData, origin: string, type: "image" | "video" | "audio", canPreview: boolean, error = ""): string {
  if (!canPreview) return downloadPage(share, origin, error, !!share.password);
  const contentUrl = `${origin}/s/${encodeURIComponent(share.id)}/content`;
  const safeName = escapeHtml(share.fileName);
  const preview = type === "image"
    ? `<img class="image" src="${contentUrl}" alt="${safeName}">`
    : type === "video"
      ? `<video controls preload="metadata"><source src="${contentUrl}">您的浏览器不支持视频播放。</video>`
      : `<div class="audio"><strong>${safeName}</strong><audio controls preload="metadata" src="${contentUrl}"></audio></div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${safeName} - 文件分享</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#161d26;color:#fff}body{min-height:100dvh}.stage{width:min(calc(100% - 48px),1440px);height:min(calc(100dvh - 48px),900px);min-height:540px;margin:24px auto;position:relative;overflow:hidden;background:#111820;border:1px solid #283543}.title{position:absolute;z-index:2;top:14px;left:14px;max-width:min(70%,680px);padding:9px 12px;background:rgba(20,28,39,.78);backdrop-filter:blur(10px);font-size:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.download{position:absolute;z-index:2;right:16px;bottom:16px;padding:11px 15px;background:#f38020;color:#fff;text-decoration:none;font-size:14px;font-weight:700}.download:hover{background:#d96d16}.image,video{display:block;width:100%;height:100%;object-fit:contain}.audio{width:min(460px,82%);height:100%;margin:auto;display:grid;place-content:center;gap:22px;text-align:center}.audio audio{width:min(460px,82vw)}@media(max-width:768px){.stage{width:100%;height:100dvh;min-height:100dvh;margin:0;border:0}.title{top:calc(12px + env(safe-area-inset-top));left:12px;max-width:calc(100% - 24px)}.download{right:16px;bottom:calc(16px + env(safe-area-inset-bottom));min-width:104px;min-height:48px;display:grid;place-items:center}.audio audio{width:min(92vw,460px)}}
</style></head><body><main class="stage"><div class="title" title="${safeName}">${safeName}</div>${preview}<a class="download" href="${origin}/s/${encodeURIComponent(share.id)}/download">下载</a></main></body></html>`;
}

function expired(): Response {
  return new Response("分享不存在、已过期或已达到下载限制", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function loadShare(context: any): Promise<ShareData | null> {
  if (!context.env.ossShares) return null;
  const value = await context.env.ossShares.get(`share:${context.params.id}`);
  return value ? JSON.parse(value) : null;
}

function page(share: ShareData, origin: string, canPreview: boolean, error = ""): string {
  const type = getMediaType(share.fileName);
  if (!type || share.allowPreview === false) return downloadPage(share, origin, error, !!share.password && !canPreview);
  return mediaPage(share, origin, type, canPreview, error);
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  try {
    const share = await loadShare(context);
    if (!share) return expired();
    if (share.host && share.host !== url.hostname) { const target = new URL(url); target.hostname = share.host; return Response.redirect(target.toString(), 302); }
    if (share.expiresAt && Date.now() > share.expiresAt) { await context.env.ossShares.delete(`share:${share.id}`); return expired(); }
    const canPreview = !share.password || await hasSharePreviewSession(context.env.ossShares, context.request.headers.get("Cookie"), share.id, url.hostname);
    return new Response(page(share, url.origin, canPreview), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) { console.error("Share page error:", error); return new Response("分享页加载失败", { status: 500 }); }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  try {
    const share = await loadShare(context);
    if (!share) return expired();
    if (share.host && share.host !== url.hostname) { const target = new URL(url); target.hostname = share.host; return Response.redirect(target.toString(), 307); }
    if (share.expiresAt && Date.now() > share.expiresAt) return expired();
    if (share.password) {
      const password = String((await context.request.formData()).get("password") || "");
      if (!password || !(await verifyPassword(password, share.password))) {
        return new Response(page(share, url.origin, false, "密码错误"), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
    }
    const headers = new Headers({ Location: `/s/${encodeURIComponent(share.id)}` });
    if (share.password) headers.set("Set-Cookie", await createSharePreviewSession(context.env.ossShares, share.id, url.hostname, share.expiresAt));
    return new Response(null, { status: 303, headers });
  } catch (error) { console.error("Share password error:", error); return new Response("验证失败", { status: 500 }); }
};
