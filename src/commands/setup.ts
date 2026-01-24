import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { build } from "esbuild";
import { RunpodClient, Pod } from "../runpod.js";
import type { Config } from "../types.js";
import { createSpinner } from "../spinner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FileResult {
  file: string;
  status: "success" | "failed" | "skipped";
  reason?: string;
}

interface DownloadStatus {
  phase: "preflight" | "downloading" | "completed" | "failed";
  currentFiles?: string[];
  totalFiles?: number;
  overallDownloadedBytes?: number;
  overallTotalBytes?: number;
  speed?: number;
  success?: number;
  failed?: number;
  skipped?: number;
  results?: FileResult[];
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function waitForPodRunning(
  client: RunpodClient,
  podId: string,
  timeoutMs = 180000,
): Promise<boolean> {
  const spinner = createSpinner("Waiting...");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pod = await client.getPod(podId);
    spinner.update(`Pod status: ${pod.desiredStatus}`);
    if (pod.desiredStatus === "RUNNING") {
      spinner.stop(`Pod status: RUNNING`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  spinner.stop("Timeout waiting for pod to start");
  return false;
}

function getProxyUrl(podId: string, port: number): string {
  return `https://${podId}-${port}.proxy.runpod.net`;
}

async function fetchStatus(
  baseUrl: string,
  token: string,
): Promise<DownloadStatus | null> {
  try {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as DownloadStatus;
  } catch {
    return null;
  }
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

async function pollDownloadProgress(
  baseUrl: string,
  token: string,
  unresponsiveTimeoutMs = 180000,
): Promise<DownloadStatus | "unresponsive"> {
  let lastSuccessTime = Date.now();
  const spinner = createSpinner("Waiting for status...");

  for (;;) {
    const status = await fetchStatus(baseUrl, token);

    if (status) {
      lastSuccessTime = Date.now();

      if (status.phase === "completed" || status.phase === "failed") {
        spinner.stop(`Status: ${status.phase}`);
        return status;
      }

      if (status.phase === "preflight") {
        spinner.update("Checking files...");
      } else if (status.phase === "downloading" && status.overallTotalBytes) {
        const percent =
          status.overallTotalBytes > 0
            ? ((status.overallDownloadedBytes || 0) /
                status.overallTotalBytes) *
              100
            : 0;
        const speedStr = status.speed ? formatBytes(status.speed) + "/s" : "?";
        const remaining =
          status.overallTotalBytes - (status.overallDownloadedBytes || 0);
        const eta =
          status.speed && status.speed > 0
            ? formatDuration((remaining / status.speed) * 1000)
            : "?";
        const done = (status.success || 0) + (status.skipped || 0);
        const failedStr = status.failed ? ` - ${status.failed} failed` : "";
        spinner.update(
          `[${done}/${status.totalFiles}] ${formatBytes(status.overallDownloadedBytes || 0)} / ${formatBytes(status.overallTotalBytes)} (${percent.toFixed(1)}%) - ${speedStr} - ETA: ${eta}${failedStr}`,
        );
      } else {
        spinner.update(`${status.phase}...`);
      }
    } else if (Date.now() - lastSuccessTime >= unresponsiveTimeoutMs) {
      spinner.stop(`Pod unresponsive for ${unresponsiveTimeoutMs / 1000}s`);
      return "unresponsive";
    }

    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function createDownloaderPod(
  client: RunpodClient,
  config: Config,
  networkVolumeId: string,
  downloaderBase64: string,
  statusToken: string,
): Promise<Pod> {
  return client.createPod({
    name: config.cpu.podName,
    imageName: config.cpu.image,
    computeType: "CPU",
    cpuFlavorIds: config.cpu.flavorIds,
    networkVolumeId: networkVolumeId,
    volumeMountPath: config.cpu.volumeMountPath,
    containerDiskInGb: 10,
    ports: ["8080/http"],
    env: {
      HF_TOKEN: config.tokens.hfToken,
      CIVITAI_TOKEN: config.tokens.civitaiToken,
      MODELS: JSON.stringify(config.models),
      TARGET_DIR: config.cpu.volumeMountPath,
      DOWNLOADER_BASE64: downloaderBase64,
      STATUS_TOKEN: statusToken,
    },
    dockerStartCmd: [
      "bash",
      "-c",
      'echo "$DOWNLOADER_BASE64" | base64 -d > /tmp/downloader.mjs && node --enable-source-maps /tmp/downloader.mjs',
    ],
  });
}

export async function setup(config: Config) {
  const client = new RunpodClient(config.tokens.runpodApiKey);

  let networkVolumeId: string;

  const existingVolume = await client.findNetworkVolumeByName(
    config.networkVolume.name,
  );
  if (existingVolume) {
    console.log(`Network volume already exists: ${existingVolume.id}`);
    networkVolumeId = existingVolume.id;

    if (
      existingVolume.size != null &&
      existingVolume.size < config.networkVolume.sizeGb
    ) {
      console.log(
        `  Resizing: ${existingVolume.size} GB -> ${config.networkVolume.sizeGb} GB`,
      );
      await client.updateNetworkVolume(existingVolume.id, {
        size: config.networkVolume.sizeGb,
      });
      console.log("  Resized");
    }
  } else {
    console.log("Creating network volume...");
    const volume = await client.createNetworkVolume(
      config.networkVolume.name,
      config.networkVolume.sizeGb,
      config.dataCenterId,
    );
    console.log(`  Created: ${volume.id}`);
    networkVolumeId = volume.id;
  }

  console.log("Bundling downloader...");
  const downloaderPath = join(__dirname, "..", "downloader.ts");
  const result = await build({
    entryPoints: [downloaderPath],
    bundle: true,
    platform: "node",
    target: "node24",
    write: false,
    format: "esm",
    sourcemap: "inline",
  });
  const downloaderCode = result.outputFiles[0].text;
  const downloaderBase64 = Buffer.from(downloaderCode).toString("base64");

  const maxAttempts = 5;
  let finalStatus: DownloadStatus | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      console.log(`\nRetry ${attempt}/${maxAttempts}...`);
    }

    let cpuPodId: string;
    let statusToken: string;

    const existingPod = await client.findPodByName(config.cpu.podName);

    if (
      existingPod &&
      existingPod.desiredStatus !== "TERMINATED" &&
      attempt > 1
    ) {
      console.log(`Deleting unresponsive pod: ${existingPod.id}`);
      await client.deletePod(existingPod.id);
    }

    if (
      existingPod &&
      existingPod.desiredStatus !== "TERMINATED" &&
      attempt === 1
    ) {
      console.log(
        `Found existing CPU pod: ${existingPod.id} (${existingPod.desiredStatus})`,
      );
      cpuPodId = existingPod.id;
      statusToken = existingPod.env?.STATUS_TOKEN || "";
      if (!statusToken) {
        throw new Error("Existing pod has no STATUS_TOKEN in env");
      }
    } else {
      console.log("Creating CPU pod for download...");
      statusToken = randomBytes(16).toString("hex");
      const pod = await createDownloaderPod(
        client,
        config,
        networkVolumeId,
        downloaderBase64,
        statusToken,
      );
      console.log(`  Created: ${pod.id}`);
      cpuPodId = pod.id;
    }

    console.log("Waiting for pod to start...");
    const started = await waitForPodRunning(client, cpuPodId);
    if (!started) {
      console.log(`Pod failed to start, deleting: ${cpuPodId}`);
      await client.deletePod(cpuPodId);
      continue;
    }

    const proxyUrl = getProxyUrl(cpuPodId, 8080);
    console.log(`  Proxy URL: ${proxyUrl}`);

    console.log("Downloading models...");
    const result = await pollDownloadProgress(proxyUrl, statusToken);

    if (result === "unresponsive") {
      console.log(`Deleting unresponsive pod: ${cpuPodId}`);
      await client.deletePod(cpuPodId);
      continue;
    }

    finalStatus = result;

    console.log("Deleting CPU pod...");
    await client.deletePod(cpuPodId);
    console.log("  Deleted");
    break;
  }

  if (!finalStatus) {
    throw new Error(
      `Download failed after ${maxAttempts} attempts due to unresponsive pods`,
    );
  }

  if (finalStatus.results) {
    const skipped = finalStatus.results.filter((r) => r.status === "skipped");
    const failed = finalStatus.results.filter((r) => r.status === "failed");

    if (skipped.length > 0) {
      console.log("\nSkipped:");
      for (const r of skipped) {
        console.log(`  ${r.file}: ${r.reason}`);
      }
    }

    if (failed.length > 0) {
      console.log("\nFailed:");
      for (const r of failed) {
        console.log(`  ${r.file}: ${r.reason}`);
      }
    }
  }

  if (finalStatus.phase === "failed") {
    throw new Error(
      `Download failed: ${finalStatus.failed} file(s) failed. ${finalStatus.error || ""}`,
    );
  }

  console.log(
    `\nSetup complete! ${finalStatus.success} downloaded, ${finalStatus.skipped || 0} skipped.`,
  );
}
