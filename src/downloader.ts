import { createHash } from "crypto";
import { once } from "events";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
} from "fs";
import { createServer } from "http";
import { dirname } from "path";
import { finished, pipeline } from "stream/promises";

interface Model {
  url: string;
  dest: string;
  sha256?: string;
}

interface ModelWithSize extends Model {
  size: number;
}

interface FileResult {
  file: string;
  status: "success" | "failed" | "skipped";
  reason?: string;
}

interface StatusInternal {
  phase: "preflight" | "downloading" | "completed" | "failed";
  currentFiles: string[];
  totalFiles: number;
  overallDownloadedBytes: number;
  overallTotalBytes: number;
  speed: number;
  results: FileResult[];
  error?: string;
}

const status: StatusInternal = {
  phase: "preflight",
  currentFiles: [],
  totalFiles: 0,
  overallDownloadedBytes: 0,
  overallTotalBytes: 0,
  speed: 0,
  results: [],
};

function serializeStatus() {
  const success = status.results.filter((r) => r.status === "success").length;
  const failed = status.results.filter((r) => r.status === "failed").length;
  const skipped = status.results.filter((r) => r.status === "skipped").length;

  return {
    ...status,
    success,
    failed,
    skipped,
  };
}

const PORT = 8080;
const TARGET_DIR = process.env.TARGET_DIR || "/workspace/models";
const HF_TOKEN = process.env.HF_TOKEN || "";
const CIVITAI_TOKEN = process.env.CIVITAI_TOKEN || "";
const STATUS_TOKEN = process.env.STATUS_TOKEN || "";

let downloadStartTime = 0;
const SPEED_WINDOW_MS = 60000;
const speedSamples: { time: number; bytes: number }[] = [];

function recordBytes(bytes: number) {
  speedSamples.push({ time: Date.now(), bytes });
}

function getRecentSpeed(): number {
  const now = Date.now();
  const cutoff = now - SPEED_WINDOW_MS;
  while (speedSamples.length > 0 && speedSamples[0].time < cutoff) {
    speedSamples.shift();
  }
  if (speedSamples.length === 0) return 0;
  const totalBytes = speedSamples.reduce((sum, s) => sum + s.bytes, 0);
  const elapsed = (now - speedSamples[0].time) / 1000;
  return elapsed > 0 ? totalBytes / elapsed : 0;
}

async function startStatusServer(): Promise<void> {
  const server = createServer((req, res) => {
    if (
      STATUS_TOKEN &&
      req.headers.authorization !== `Bearer ${STATUS_TOKEN}`
    ) {
      res.writeHead(401);
      res.end();
      return;
    }

    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeStatus()));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(PORT);
  await once(server, "listening");
  console.log(`Status server listening on port ${PORT}`);
}

function getAuthHeaders(url: string): Record<string, string> {
  if (url.includes("huggingface.co") && HF_TOKEN) {
    return { Authorization: `Bearer ${HF_TOKEN}` };
  }
  if (url.includes("civitai.com") && CIVITAI_TOKEN) {
    return { Authorization: `Bearer ${CIVITAI_TOKEN}` };
  }
  return {};
}

function getDomain(url: string): string {
  return new URL(url).hostname;
}

async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins}m`;
}

function updateStatus(currentFiles: string[]) {
  status.speed = getRecentSpeed();
  status.currentFiles = currentFiles;
}

async function fetchFileSize(model: Model): Promise<number> {
  try {
    const res = await fetch(model.url, {
      headers: {
        ...getAuthHeaders(model.url),
        Range: "bytes=0-0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });

    if (res.status === 206) {
      const contentRange = res.headers.get("content-range");
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    }

    if (res.ok || res.status === 206) {
      return parseInt(res.headers.get("content-length") || "0", 10);
    }

    console.error(`  Failed to get size for ${model.dest}: ${res.status}`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  Failed to get size for ${model.dest}: ${msg}`);
    return 0;
  }
}

interface DownloadResult {
  status: "success" | "failed";
  reason?: string;
}

async function checkNeedsDownload(
  model: Model,
  remoteSize: number,
): Promise<{ skip: boolean; reason?: string }> {
  const destPath = `${TARGET_DIR}/${model.dest}`;

  if (!existsSync(destPath)) {
    return { skip: false };
  }

  const localSize = statSync(destPath).size;

  if (model.sha256) {
    const hash = await computeSha256(destPath);
    if (hash === model.sha256) {
      return { skip: true, reason: "hash match" };
    }
    return { skip: false };
  }

  if (remoteSize > 0 && localSize === remoteSize) {
    return { skip: true, reason: "size match" };
  }

  if (remoteSize > 0 && localSize !== remoteSize) {
    return { skip: false };
  }

  return { skip: true, reason: "file exists" };
}

async function downloadModel(
  model: ModelWithSize,
  onProgress: (bytes: number) => void,
): Promise<DownloadResult> {
  const destPath = `${TARGET_DIR}/${model.dest}`;

  mkdirSync(dirname(destPath), { recursive: true });

  console.log(`Downloading ${model.dest}...`);

  const res = await fetch(model.url, {
    headers: getAuthHeaders(model.url),
    redirect: "follow",
  });

  if (!res.ok) {
    console.error(`  Failed: ${res.status} ${res.statusText}`);
    return { status: "failed", reason: `${res.status} ${res.statusText}` };
  }

  const body = res.body;
  if (!body) {
    console.error("  Failed: No response body");
    return { status: "failed", reason: "no response body" };
  }

  const fileStream = createWriteStream(destPath);
  const reader = body.getReader();
  let totalWritten = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    totalWritten += value.length;
    onProgress(value.length);
  }

  fileStream.end();
  await finished(fileStream);

  console.log(`  Done: ${model.dest} (${totalWritten} bytes written)`);

  if (model.size > 0 && totalWritten !== model.size) {
    console.error(
      `  Size mismatch: expected ${model.size}, got ${totalWritten}`,
    );
    return {
      status: "failed",
      reason: `size mismatch: expected ${model.size}, got ${totalWritten}`,
    };
  }

  if (model.sha256) {
    console.log("  Verifying hash...");
    const hash = await computeSha256(destPath);
    if (hash !== model.sha256) {
      console.log(
        `  FAILED (expected ${model.sha256.slice(0, 8)}..., got ${hash.slice(0, 8)}...)`,
      );
      return { status: "failed", reason: "hash mismatch" };
    }
    console.log("  OK");
  }

  return { status: "success" };
}

async function downloadDomainQueue(
  models: ModelWithSize[],
  activeFiles: Set<string>,
) {
  for (const model of models) {
    activeFiles.add(model.dest);
    updateStatus([...activeFiles]);

    const result = await downloadModel(model, (bytes) => {
      status.overallDownloadedBytes += bytes;
      recordBytes(bytes);
      updateStatus([...activeFiles]);
    });

    status.results.push({
      file: model.dest,
      status: result.status,
      reason: result.reason,
    });
    activeFiles.delete(model.dest);
    updateStatus([...activeFiles]);
  }
}

async function main() {
  await startStatusServer();

  const modelsJson = process.env.MODELS;
  if (!modelsJson) {
    status.phase = "failed";
    status.error = "MODELS environment variable is not set";
    console.error(status.error);
    return;
  }

  const models: Model[] = JSON.parse(modelsJson);
  status.totalFiles = models.length;

  console.log(`=== Checking ${models.length} model(s) ===\n`);

  const modelsWithSize: ModelWithSize[] = [];
  for (const model of models) {
    const size = await fetchFileSize(model);
    const { skip, reason } = await checkNeedsDownload(model, size);

    if (skip) {
      console.log(`  ${model.dest}: ${formatBytes(size)} (skipped: ${reason})`);
      status.results.push({ file: model.dest, status: "skipped", reason });
    } else {
      console.log(`  ${model.dest}: ${formatBytes(size)}`);
      modelsWithSize.push({ ...model, size });
      status.overallTotalBytes += size;
    }
  }

  const { skipped } = serializeStatus();
  console.log(
    `\nTotal: ${formatBytes(status.overallTotalBytes)} (${skipped} skipped)\n`,
  );

  if (modelsWithSize.length === 0) {
    console.log("All files already downloaded.");
    status.phase = "completed";
    return;
  }

  console.log(
    `=== Downloading ${modelsWithSize.length} file(s) to ${TARGET_DIR} ===\n`,
  );

  status.phase = "downloading";
  downloadStartTime = Date.now();

  const byDomain = Map.groupBy(modelsWithSize, (model) => getDomain(model.url));

  const activeFiles = new Set<string>();

  const domainPromises = [...byDomain.values()].map((domainModels) =>
    downloadDomainQueue(domainModels, activeFiles),
  );

  const downloadCount = modelsWithSize.length;

  const progressInterval = setInterval(() => {
    const { success, failed } = serializeStatus();
    const downloaded = success + failed;
    const remaining = status.overallTotalBytes - status.overallDownloadedBytes;
    const eta =
      status.speed > 0
        ? formatDuration((remaining / status.speed) * 1000)
        : "?";
    const percent =
      status.overallTotalBytes > 0
        ? (
            (status.overallDownloadedBytes / status.overallTotalBytes) *
            100
          ).toFixed(1)
        : "0.0";

    const failedStr = failed > 0 ? ` - ${failed} failed` : "";
    console.log(
      `[${downloaded}/${downloadCount}] ${formatBytes(status.overallDownloadedBytes)} / ${formatBytes(status.overallTotalBytes)} (${percent}%) - ${formatBytes(status.speed)}/s - ETA: ${eta}${failedStr}`,
    );
  }, 3000);

  await Promise.all(domainPromises);

  clearInterval(progressInterval);

  const finalStatus = serializeStatus();

  const elapsed = Date.now() - downloadStartTime;
  const parts = [
    `${finalStatus.success} downloaded`,
    `${finalStatus.skipped} skipped`,
  ];
  if (finalStatus.failed > 0) parts.push(`${finalStatus.failed} failed`);
  console.log(
    `\n=== Complete: ${parts.join(", ")} (${formatDuration(elapsed)}) ===`,
  );

  status.phase = finalStatus.failed > 0 ? "failed" : "completed";
}

main();
