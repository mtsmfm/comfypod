import type { Config, Model } from "../types.js";

function getAuthHeaders(
  url: string,
  hfToken: string,
  civitaiToken: string,
): Record<string, string> {
  if (url.includes("huggingface.co") && hfToken) {
    return { Authorization: `Bearer ${hfToken}` };
  }
  if (url.includes("civitai.com") && civitaiToken) {
    return { Authorization: `Bearer ${civitaiToken}` };
  }
  return {};
}

async function fetchFileSize(
  model: Model,
  hfToken: string,
  civitaiToken: string,
): Promise<number> {
  const res = await fetch(model.url, {
    headers: {
      ...getAuthHeaders(model.url, hfToken, civitaiToken),
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

  throw new Error(`Failed to get size: ${res.status}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function estimate(config: Config) {
  if (config.models.length === 0) {
    console.log("No models configured.");
    return;
  }

  console.log(`Fetching sizes for ${config.models.length} model(s)...\n`);

  let totalBytes = 0;
  const results: { dest: string; size: number; error?: string }[] = [];

  for (const model of config.models) {
    process.stdout.write(`  ${model.dest}: `);
    try {
      const size = await fetchFileSize(
        model,
        config.tokens.hfToken,
        config.tokens.civitaiToken,
      );
      console.log(formatBytes(size));
      results.push({ dest: model.dest, size });
      totalBytes += size;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`error (${msg})`);
      results.push({ dest: model.dest, size: 0, error: msg });
    }
  }

  const totalGb = totalBytes / (1024 * 1024 * 1024);
  const recommended = Math.ceil(totalGb + 5);

  console.log(`\nTotal: ${formatBytes(totalBytes)}`);
  console.log(`Recommended volume size: ${recommended} GB`);
}
