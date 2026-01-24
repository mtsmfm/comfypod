import { RunpodClient } from "../runpod.js";
import type { Config } from "../types.js";

export async function status(config: Config) {
  const client = new RunpodClient(config.tokens.runpodApiKey);

  console.log("=== Network Volume ===");
  const volume = await client.findNetworkVolumeByName(
    config.networkVolume.name,
  );
  if (volume) {
    console.log(`  ID: ${volume.id}`);
    console.log(`  Name: ${volume.name}`);
    console.log(`  Size: ${volume.size} GB`);
    console.log(`  Data Center: ${volume.dataCenterId}`);
  } else {
    console.log("  (not found)");
  }

  console.log("\n=== GPU Pod ===");
  const gpuPod = await client.findPodByName(config.gpu.podName);
  if (gpuPod) {
    console.log(`  ID: ${gpuPod.id}`);
    console.log(`  Name: ${gpuPod.name}`);
    console.log(`  Status: ${gpuPod.desiredStatus}`);
    const user = gpuPod.env?.AUTH_USERNAME;
    const password = gpuPod.env?.AUTH_PASSWORD;
    if (user && password) {
      console.log(
        `  URL: https://${user}:${password}@${gpuPod.id}-${config.gpu.proxyPort}.proxy.runpod.net`,
      );
    }
  } else {
    console.log("  (not found)");
  }

  console.log("\n=== CPU Pod ===");
  const cpuPod = await client.findPodByName(config.cpu.podName);
  if (cpuPod) {
    console.log(`  ID: ${cpuPod.id}`);
    console.log(`  Name: ${cpuPod.name}`);
    console.log(`  Status: ${cpuPod.desiredStatus}`);
  } else {
    console.log("  (not found)");
  }
}
