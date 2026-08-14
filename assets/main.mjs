import { encodePathForUrl } from "./url-utils.mjs";
const THUMBNAIL_SIZE = 144;

/**
 * @param {File} file
 */
export async function generateThumbnail(file) {
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  var ctx = canvas.getContext("2d");

  /** @type HTMLImageElement */
  if (file.type.startsWith("image/")) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Image load failed"));
        image.src = objectUrl;
      });
      ctx.drawImage(image, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } else if (file.type === "video/mp4") {
    // Generate thumbnail from video
    const objectUrl = URL.createObjectURL(file);
    try {
      const video = await new Promise(async (resolve, reject) => {
        const video = document.createElement("video");
        const timeoutId = setTimeout(() => reject(new Error("Video load timeout")), 2000);

        try {
          video.muted = true;
          video.src = objectUrl;
          await video.play();
          await video.pause();
          video.currentTime = 0;
          clearTimeout(timeoutId);
          resolve(video);
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      ctx.drawImage(video, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /** @type Blob */
  const thumbnailBlob = await new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob))
  );

  return thumbnailBlob;
}

/**
 * @param {Blob} blob
 */
export async function blobDigest(blob) {
  const digest = await crypto.subtle.digest("SHA-1", await blob.arrayBuffer());
  const digestArray = Array.from(new Uint8Array(digest));
  const digestHex = digestArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return digestHex;
}

export const SIZE_LIMIT = 80 * 1000 * 1000; // 80MB
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 800;
const DEFAULT_CONCURRENCY = 3;
const PART_TIMEOUT_MS = 120000; // 2 minutes per part

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  if (error?.code === "ERR_NETWORK" || error?.code === "ECONNABORTED") return true;
  if (!error?.response) return true;
  return error.response.status >= 500;
}

/**
 * @param {string} key
 * @param {File} file
 * @param {Record<string, any>} options
 */
export async function multipartUpload(key, file, options) {
  const encodedKey = encodePathForUrl(key);
  const headers = options?.headers || {};
  const chunkSize = Number.isFinite(options?.chunkSize)
    ? Math.max(1024 * 1024, options.chunkSize)
    : SIZE_LIMIT;
  const maxRetries = Number.isFinite(options?.retries)
    ? Math.max(0, options.retries)
    : DEFAULT_MAX_RETRIES;
  const retryDelayMs = Number.isFinite(options?.retryDelayMs)
    ? Math.max(0, options.retryDelayMs)
    : DEFAULT_RETRY_DELAY_MS;
  const concurrency = Number.isFinite(options?.concurrency)
    ? Math.max(1, options.concurrency)
    : DEFAULT_CONCURRENCY;
  headers["content-type"] = file.type;

  const resumeUploadId = options?.resume?.uploadId;
  const initialParts = Array.isArray(options?.resume?.uploadedParts)
    ? options.resume.uploadedParts.slice()
    : [];
  // 用 Set 按 partNumber 判断已完成分片，避免数组压实后的下标错位。
  const completedParts = new Set(initialParts.map((p) => p.partNumber));
  // uploadedParts 按 partNumber-1 存储为稀疏数组，不重新压实。
  const uploadedParts = [];
  for (const part of initialParts) {
    uploadedParts[part.partNumber - 1] = part;
  }

  const uploadId = resumeUploadId
    ? resumeUploadId
    : await axios
        .post(`/api/write/items/${encodedKey}?uploads`, "", {
          headers: {
            ...headers,
            "x-fd-chunk-size": String(chunkSize),
            "x-fd-total-size": String(file.size),
          },
        })
        .then((res) => res.data.uploadId);
  const totalChunks = Math.ceil(file.size / chunkSize);

  const abortController = new AbortController();

  const uploadPartWithRetry = async (partNumber, chunk) => {
    const searchParams = new URLSearchParams({ partNumber, uploadId });
    let attempt = 0;
    while (true) {
      if (abortController.signal.aborted) throw Object.assign(new Error("ABORTED"), { aborted: true });
      try {
        const response = await axios.put(
          `/api/write/items/${encodedKey}?${searchParams}`,
          chunk,
          {
            headers,
            timeout: PART_TIMEOUT_MS,
            signal: abortController.signal,
            onUploadProgress(progressEvent) {
              if (typeof options?.onUploadProgress !== "function") return;
              options.onUploadProgress({
                loaded: (partNumber - 1) * chunkSize + progressEvent.loaded,
                total: file.size,
                partNumber,
                partLoaded: progressEvent.loaded,
                partSize: chunk.size,
              });
            },
          }
        );
        return { partNumber, etag: response.headers.etag };
      } catch (error) {
        if (abortController.signal.aborted || error?.aborted) {
          throw Object.assign(new Error("ABORTED"), { aborted: true });
        }
        error.partNumber = partNumber;
        if (!isRetryableError(error) || attempt >= maxRetries) throw error;
        const jitter = Math.floor(Math.random() * 200);
        const delay = retryDelayMs * Math.pow(2, attempt) + jitter;
        attempt += 1;
        await sleep(delay);
      }
    }
  };

  const pendingParts = [];
  for (let i = 1; i <= totalChunks; i++) {
    if (completedParts.has(i)) continue;
    const chunk = file.slice((i - 1) * chunkSize, i * chunkSize);
    pendingParts.push({ partNumber: i, chunk });
  }

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, pendingParts.length || 1);
  let firstError = null;

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < pendingParts.length) {
      if (abortController.signal.aborted) return;
      const current = pendingParts[nextIndex];
      nextIndex += 1;
      try {
        const { partNumber, etag } = await uploadPartWithRetry(current.partNumber, current.chunk);
        uploadedParts[partNumber - 1] = { partNumber, etag };
        completedParts.add(partNumber);
      } catch (error) {
        if (error?.aborted) return;
        if (!firstError) {
          firstError = error;
          abortController.abort();
        }
        return;
      }
    }
  });

  await Promise.all(workers);

  if (firstError) {
    const multipartError = new Error("Multipart upload failed");
    multipartError.isMultipartUpload = true;
    multipartError.partNumber = firstError?.partNumber;
    multipartError.uploadId = uploadId;
    multipartError.uploadedParts = uploadedParts.filter(Boolean);
    multipartError.totalChunks = totalChunks;
    multipartError.cause = firstError;
    throw multipartError;
  }

  // complete() 失败也需保存续传信息
  try {
    const completeParams = new URLSearchParams({ uploadId });
    await axios.post(
      `/api/write/items/${encodedKey}?${completeParams}`,
      { parts: uploadedParts.filter(Boolean).sort((a, b) => a.partNumber - b.partNumber) },
      { headers }
    );
  } catch (error) {
    const multipartError = new Error("Multipart upload complete failed");
    multipartError.isMultipartUpload = true;
    multipartError.uploadId = uploadId;
    multipartError.uploadedParts = uploadedParts.filter(Boolean);
    multipartError.totalChunks = totalChunks;
    multipartError.cause = error;
    throw multipartError;
  }
}
