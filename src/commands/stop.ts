import { RunpodClient } from "../runpod.js";
import type { Config } from "../types.js";

export async function stop(config: Config) {
  const client = new RunpodClient(config.tokens.runpodApiKey);

  const pod = await client.findPodByName(config.gpu.podName);

  if (!pod) {
    console.log("No GPU pod to stop.");
    return;
  }

  console.log(`Stopping GPU pod: ${pod.id}`);
  await client.stopPod(pod.id);
  console.log("Deleting GPU pod...");
  await client.deletePod(pod.id);

  console.log("GPU pod stopped and deleted. Network volume preserved.");
}
