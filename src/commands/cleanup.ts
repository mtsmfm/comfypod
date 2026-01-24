import { RunpodClient } from "../runpod.js";
import type { Config } from "../types.js";

export async function cleanup(config: Config) {
  const client = new RunpodClient(config.tokens.runpodApiKey);

  const gpuPod = await client.findPodByName(config.gpu.podName);
  if (gpuPod) {
    console.log(`Deleting GPU pod: ${gpuPod.id}`);
    const deleted = await client.tryDeletePod(gpuPod.id);
    if (deleted) {
      console.log("  Deleted");
    } else {
      console.log("  Not found (already deleted)");
    }
  }

  const cpuPod = await client.findPodByName(config.cpu.podName);
  if (cpuPod) {
    console.log(`Deleting CPU pod: ${cpuPod.id}`);
    const deleted = await client.tryDeletePod(cpuPod.id);
    if (deleted) {
      console.log("  Deleted");
    } else {
      console.log("  Not found (already deleted)");
    }
  }

  const volume = await client.findNetworkVolumeByName(
    config.networkVolume.name,
  );
  if (volume) {
    console.log(`Deleting network volume: ${volume.id}`);
    const deleted = await client.tryDeleteNetworkVolume(volume.id);
    if (deleted) {
      console.log("  Deleted");
    } else {
      console.log("  Not found (already deleted)");
    }
  }

  console.log("Cleanup complete.");
}
