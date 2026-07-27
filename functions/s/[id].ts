import { ShareData, verifyPassword, formatFileSize } from "@/utils/share";
import { createSharePreviewSession, hasSharePreviewSession } from "@/utils/share-session";

interface Env {
  ossShares: KVNamespace;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fileType(fileName: string, contentType = ""): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (contentType.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  if (contentType.startsWith("video/") || ["mp4", "webm", "ogg", "mov", "m4v"].includes(ext)) return "video";
  if (contentType.startsWith("audio/") || ["mp3", "wav", "flac", "m4a", "aac"].includes(ext)) return "audio";
  if (contentType === "application/pdf" || ext === "pdf") return "pdf";
  if (["txt", "log", "md", "markdown", "json", "yaml", "yml", "js", "ts", "css", "html", "htm", "xml", "py", "sh", "sql"].includes(ext) || contentType.startsWith("text/")) return "text";
  return "download";
}

function renderPreview(type: string, contentUrl: string, fileName: string): string {
  const safeUrl = escapeHtml(contentUrl);
  const safeName = escapeHtml(fileName);
  if (type === "image") return `<img class="media image" src="${safeUrl}" alt="${safeName}">`;
  if (type === "video") return `<video class="media" controls preload="metadata"><source src="${safeUrl}">您的浏览器不支持视频预览。</video>`;
  if (type === "audio") return `<div class="audio-stage"><div class="audio-name">${safeName}</div><audio controls preload="metadata" src="${safeUrl}"></audio></div>`;
  if (type === "pdf") return `<iframe class="document-frame" src="${safeUrl}#view=FitH" title="${safeName}"></iframe>`;
  if (type === "text") return `<iframe class="document-frame" sandbox src="${safeUrl}" title="${safeName}"></iframe>`;
  return `<div class="unsupported"><strong>此文件暂不支持在线预览</strong><span>您仍可使用下载按钮获取原文件。</span></div>`;
}

function generateSharePage(share: ShareData, origin: string, error = "", canPreview = !share.password): string {
  const type = fileType(share.fileName);
  const previewEnabled = share.allowPreview !== false && canPreview;
  const contentUrl = `${origin}/s/${encodeURIComponent(share.id)}/content`;
  const expiryText = share.expiresAt ? new Date(share.expiresAt).toLocaleString("zh-CN") : "永久有效";
  const downloadText = share.maxDownloads ? `${share.maxDownloads - share.downloads} / ${share.maxDownloads}` : "无限制";
  const metadata = `<dl><div><dt>文件大小</dt><dd>${formatFileSize(share.fileSize)}</dd></div><div><dt>有效期</dt><dd>${expiryText}</dd></div><div><dt>剩余下载</dt><dd>${downloadText}</dd></div>${share.password ? "<div><dt>访问保护</dt><dd>密码保护</dd></div>" : ""}</dl>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(share.fileName)} - 文件分享</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#eef2f6;color:#1b2638}body{min-height:100dvh}.share-shell{min-height:100dvh;padding:24px;display:grid;place-items:center}.stage{width:min(100%,1440px);height:min(900px,calc(100dvh - 48px));min-height:540px;position:relative;overflow:hidden;border:1px solid #d7dee8;background:#171d26;box-shadow:0 20px 45px rgba(28,42,60,.16)}.media,.document-frame{display:block;width:100%;height:100%;border:0;object-fit:contain;background:#171d26}.image{cursor:zoom-in}.audio-stage,.unsupported{height:100%;display:grid;place-content:center;gap:18px;padding:32px;text-align:center;color:#d9e2ef}.audio-stage audio{width:min(460px,78vw)}.audio-name{max-width:min(600px,78vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.unsupported span{color:#a8b5c4;font-size:14px}.topbar{position:absolute;top:16px;left:16px;right:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;z-index:2;pointer-events:none}.file-label,.actions{pointer-events:auto}.file-label{max-width:min(62vw,640px);padding:10px 14px;background:rgba(21,29,40,.78);backdrop-filter:blur(12px);color:#fff;border:1px solid rgba(255,255,255,.16);font-size:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.actions{display:flex;gap:8px}.icon-button{width:44px;height:44px;border:0;background:rgba(21,29,40,.82);color:#fff;cursor:pointer;font-size:19px;border:1px solid rgba(255,255,255,.16)}.icon-button:hover,.icon-button:focus{background:#f38020;outline:2px solid #fff;outline-offset:2px}.download-button{position:absolute;right:20px;bottom:20px;z-index:3;display:flex;align-items:center;gap:8px;padding:13px 17px;background:#f38020;color:#fff;text-decoration:none;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.28)}.download-button:hover{background:#d96712}.panel{position:absolute;right:16px;top:72px;width:min(360px,calc(100% - 32px));padding:20px;background:rgba(255,255,255,.97);box-shadow:0 12px 34px rgba(0,0,0,.22);z-index:4}.panel[hidden]{display:none}.panel h2{font-size:16px;margin:0 0 16px;word-break:break-word}.panel dl{margin:0}.panel dl div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid #e5eaf0;font-size:14px}.panel dt{color:#627085}.panel dd{margin:0;text-align:right;word-break:break-word}.auth-layer{position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:rgba(21,29,40,.86);padding:24px}.auth-card{width:min(100%,380px);background:#fff;padding:24px;box-shadow:0 18px 48px rgba(0,0,0,.28)}.auth-card h1{font-size:18px;margin:0 0 8px}.auth-card p{margin:0 0 18px;color:#627085;font-size:14px}.auth-card input{width:100%;padding:12px;border:1px solid #b9c5d2;font-size:16px}.auth-card button{margin-top:12px;width:100%;padding:12px;border:0;background:#f38020;color:#fff;font-weight:700;font-size:15px;cursor:pointer}.error{margin:0 0 12px;padding:10px;background:#fff1f0;color:#ba2b23;font-size:14px}@media(max-width:768px){.share-shell{padding:0}.stage{width:100%;height:100dvh;min-height:100dvh;border:0}.topbar{top:calc(12px + env(safe-area-inset-top));left:12px;right:12px}.file-label{max-width:calc(100vw - 132px)}.download-button{right:16px;bottom:calc(16px + env(safe-area-inset-bottom));width:52px;height:52px;padding:0;justify-content:center;border-radius:50%;font-size:0}.download-button::before{content:"↓";font-size:25px}.panel{top:unset;bottom:0;right:0;width:100%;padding:20px max(20px,env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));box-shadow:0 -14px 32px rgba(0,0,0,.22)}.document-frame{background:#fff}.audio-stage audio{width:min(92vw,460px)}}
</style></head><body><main class="share-shell"><section class="stage" aria-label="文件分享预览"><div class="topbar"><div class="file-label" title="${escapeHtml(share.fileName)}">${escapeHtml(share.fileName)}</div><div class="actions"><button id="info-button" class="icon-button" type="button" aria-label="查看文件信息" aria-expanded="false">i</button></div></div>${previewEnabled ? renderPreview(type, contentUrl, share.fileName) : ""}<aside id="info-panel" class="panel" hidden><h2>${escapeHtml(share.fileName)}</h2>${metadata}</aside>${error ? `<div class="auth-layer"><form class="auth-card" method="POST"><h1>输入访问密码</h1><p>验证后可预览和下载此文件。</p><div class="error">${escapeHtml(error)}</div><input type="password" name="password" placeholder="访问密码" required autofocus><button type="submit">验证并预览</button></form></div>` : share.password && !canPreview ? `<div class="auth-layer"><form class="auth-card" method="POST"><h1>输入访问密码</h1><p>验证后可预览和下载此文件。</p><input type="password" name="password" placeholder="访问密码" required autofocus><button type="submit">验证并预览</button></form></div>` : ""}<a class="download-button" href="${origin}/s/${encodeURIComponent(share.id)}/download" aria-label="下载文件">下载</a></section></main><script>const button=document.getElementById('info-button'),panel=document.getElementById('info-panel');button.addEventListener('click',()=>{const hidden=panel.hasAttribute('hidden');panel.toggleAttribute('hidden',!hidden);button.setAttribute('aria-expanded',String(hidden))});</script></body></html>`;
}

function expiredPage(): Response {
  return new Response("分享不存在、已过期或已达到下载限制", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function loadShare(context: any): Promise<ShareData | null> {
  if (!context.env.ossShares) return null;
  const value = await context.env.ossShares.get(`share:${context.params.id}`);
  return value ? JSON.parse(value) : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const requestUrl = new URL(context.request.url);
  try {
    const share = await loadShare(context);
    if (!share) return expiredPage();
    if (share.host && share.host !== requestUrl.hostname) { const target = new URL(requestUrl); target.hostname = share.host; return Response.redirect(target.toString(), 302); }
    if (share.expiresAt && Date.now() > share.expiresAt) { await context.env.ossShares.delete(`share:${share.id}`); return expiredPage(); }
    const canPreview = !share.password || await hasSharePreviewSession(context.env.ossShares, context.request.headers.get("Cookie"), share.id, requestUrl.hostname);
    return new Response(generateSharePage(share, requestUrl.origin, "", canPreview), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) { console.error("Share page error:", error); return new Response("分享页加载失败", { status: 500 }); }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const requestUrl = new URL(context.request.url);
  try {
    const share = await loadShare(context);
    if (!share) return expiredPage();
    if (share.host && share.host !== requestUrl.hostname) { const target = new URL(requestUrl); target.hostname = share.host; return Response.redirect(target.toString(), 307); }
    if (share.expiresAt && Date.now() > share.expiresAt) return expiredPage();
    if (share.password) {
      const password = String((await context.request.formData()).get("password") || "");
      if (!password || !(await verifyPassword(password, share.password))) {
        return new Response(generateSharePage(share, requestUrl.origin, "密码错误", false), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
    }
    const headers = new Headers({ Location: `/s/${encodeURIComponent(share.id)}` });
    if (share.password) headers.set("Set-Cookie", await createSharePreviewSession(context.env.ossShares, share.id, requestUrl.hostname, share.expiresAt));
    return new Response(null, { status: 303, headers });
  } catch (error) { console.error("Share password error:", error); return new Response("验证失败", { status: 500 }); }
};
