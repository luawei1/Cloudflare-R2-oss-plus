import { parseBucketPath } from "@/utils/bucket";
import { getWriteAuthStatusForPathAsync } from "@/utils/auth";
import {
  REMOTE_IMPORT_MAX_BYTES,
  buildRemoteImportKey,
  createByteLimitedStream,
  deriveRemoteFileName,
  parseContentLength,
  validateRemoteUrl,
} from "@/utils/remote-import";

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

function importError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "从链接导入失败";
  if (message === "REMOTE_IMPORT_SIZE_LIMIT") return json({ error: "源文件超过 200MB 限制" }, 413);
  if (message.startsWith("REMOTE_IMPORT_")) return json({ error: message.slice("REMOTE_IMPORT_".length) }, 502);
  return json({ error: message }, 400);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { url?: string; targetDir?: string; fileName?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "请求内容必须为 JSON" }, 400);
  }

  try {
    const sourceUrl = validateRemoteUrl(String(body.url || "").trim());
    const fallbackName = body.fileName?.trim() || deriveRemoteFileName(sourceUrl, null);
    const preliminaryKey = buildRemoteImportKey(body.targetDir || "", fallbackName);

    if (!(await getWriteAuthStatusForPathAsync(context, preliminaryKey))) {
      return json({ error: "没有向目标目录写入文件的权限" }, 403);
    }

    const [bucket] = await parseBucketPath(context);
    if (!bucket) return json({ error: "存储桶未配置" }, 500);
    if (bucket.backend === "onedrive") {
      return json({ error: "当前 OneDrive 后端暂不支持从链接导入" }, 422);
    }

    const sourceResponse = await fetch(sourceUrl.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { "Accept": "*/*" },
    });
    if (sourceResponse.status >= 300 && sourceResponse.status < 400) {
      return json({ error: "链接发生重定向，请使用最终可直接下载的地址" }, 422);
    }
    if (!sourceResponse.ok) {
      return json({ error: `源站返回 ${sourceResponse.status}，可能需要登录或访问授权` }, 502);
    }
    if (!sourceResponse.body) return json({ error: "源站未返回文件内容" }, 502);

    const contentLength = parseContentLength(sourceResponse.headers.get("Content-Length"));
    if (contentLength !== null && contentLength > REMOTE_IMPORT_MAX_BYTES) {
      return json({ error: "源文件超过 200MB 限制" }, 413);
    }

    const fileName = body.fileName?.trim() || deriveRemoteFileName(sourceUrl, sourceResponse.headers.get("Content-Disposition"));
    const targetKey = buildRemoteImportKey(body.targetDir || "", fileName);
    if (targetKey !== preliminaryKey && !(await getWriteAuthStatusForPathAsync(context, targetKey))) {
      return json({ error: "没有向目标目录写入文件的权限" }, 403);
    }
    if (typeof bucket.head === "function" && await bucket.head(targetKey)) {
      return json({ error: "目标文件已存在，请改名或先处理原文件" }, 409);
    }

    const limited = createByteLimitedStream(sourceResponse.body);
    const contentType = sourceResponse.headers.get("Content-Type") || "application/octet-stream";
    await bucket.put(targetKey, limited.stream, {
      httpMetadata: { contentType },
      contentLength: contentLength || undefined,
    });

    return json({
      success: true,
      file: { key: targetKey, size: limited.getBytesRead(), contentType },
    });
  } catch (error) {
    console.error("Remote import error:", error);
    return importError(error);
  }
};
