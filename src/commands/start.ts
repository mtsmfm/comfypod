import { randomBytes } from "crypto";
import { RunpodClient } from "../runpod.js";
import type { Config, CustomNode } from "../types.js";
import { createSpinner } from "../spinner.js";

const AUTH_USERNAME = "admin";

function generatePassword(): string {
  return randomBytes(16).toString("hex");
}

function getProxyUrl(podId: string, port: number): string {
  return `https://${podId}-${port}.proxy.runpod.net`;
}

function getAuthUrl(
  podId: string,
  port: number,
  username: string,
  password: string,
): string {
  return `https://${username}:${password}@${podId}-${port}.proxy.runpod.net`;
}

async function waitForPodRunning(
  client: RunpodClient,
  podId: string,
  timeoutMs = 300000,
) {
  const spinner = createSpinner("Waiting...");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pod = await client.getPod(podId);
    spinner.update(`Pod status: ${pod.desiredStatus}`);
    if (pod.desiredStatus === "RUNNING") {
      spinner.stop(`Pod status: RUNNING`);
      return pod;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  spinner.stop("Timeout waiting for pod to start");
  throw new Error("Timeout waiting for pod to start");
}

async function waitForServiceReady(
  url: string,
  username: string,
  password: string,
  timeoutMs = 600000,
): Promise<void> {
  const spinner = createSpinner("Connecting...");
  const start = Date.now();
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  while (Date.now() - start < timeoutMs) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        spinner.stop("Service ready");
        return;
      }
      spinner.update(`Service not ready: ${res.status}`);
    } catch (e) {
      spinner.update(
        `Service not ready: ${e instanceof Error ? e.message : e}`,
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  spinner.stop("Timeout waiting for service to be ready");
  throw new Error("Timeout waiting for service to be ready");
}

const CADDY_VERSION = "2.9.1";
const CADDY_URL = `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz`;

function getNodeName(node: CustomNode): string {
  if (node.name) return node.name;
  const match = node.repo.match(/\/([^/]+?)(\.git)?$/);
  return match ? match[1] : node.repo;
}

function buildCustomNodesScript(
  customNodes: CustomNode[],
  customNodesDir: string,
): string {
  if (customNodes.length === 0) return "";

  const installCommands = customNodes
    .map((node) => {
      const name = getNodeName(node);
      const dir = `${customNodesDir}/${name}`;
      return `if [ ! -d "${dir}" ]; then
  echo "  Installing ${name}..."
  git clone "${node.repo}" "${dir}"
  if [ -f "${dir}/requirements.txt" ]; then
    pip install -r "${dir}/requirements.txt"
  fi
else
  echo "  ${name} already installed"
fi`;
    })
    .join("\n");

  return `
echo "=== Installing Custom Nodes ==="
${installCommands}
`;
}

function buildStartupScript(
  proxyPort: number,
  targetPort: number,
  entrypoint: string,
  customNodes: CustomNode[],
  customNodesDir: string,
  preCommands: string[],
): string {
  const customNodesScript = buildCustomNodesScript(customNodes, customNodesDir);
  const preCommandsScript =
    preCommands.length > 0
      ? `\necho "=== Running pre-commands ==="\n${preCommands.join("\n")}\n`
      : "";

  return `
set -e

echo "=== Setting up Basic Auth Proxy ==="
echo "  Username: $AUTH_USERNAME"
echo "  Password: $AUTH_PASSWORD"

curl -sL ${CADDY_URL} | tar xz -C /tmp caddy

HASHED=$(/tmp/caddy hash-password --plaintext "$AUTH_PASSWORD")

cat > /tmp/Caddyfile <<EOF
:${proxyPort} {
    basic_auth {
        \$AUTH_USERNAME \$HASHED
    }
    reverse_proxy localhost:${targetPort}
}
EOF

/tmp/caddy run --config /tmp/Caddyfile &
${customNodesScript}${preCommandsScript}
exec bash ${entrypoint}
`.trim();
}

export async function start(config: Config) {
  const client = new RunpodClient(config.tokens.runpodApiKey);

  const volume = await client.findNetworkVolumeByName(
    config.networkVolume.name,
  );
  if (!volume) {
    console.error("No network volume. Run 'setup' first.");
    process.exit(1);
  }

  const existingPod = await client.findPodByName(config.gpu.podName);
  if (existingPod && existingPod.desiredStatus !== "TERMINATED") {
    console.log(
      `Found existing GPU pod: ${existingPod.id} (${existingPod.desiredStatus})`,
    );
    const password = existingPod.env?.AUTH_PASSWORD;
    if (password) {
      const authUrl = getAuthUrl(
        existingPod.id,
        config.gpu.proxyPort,
        AUTH_USERNAME,
        password,
      );
      console.log(`  URL: ${authUrl}`);
    } else {
      const proxyUrl = getProxyUrl(existingPod.id, config.gpu.proxyPort);
      console.log(`  URL: ${proxyUrl}`);
    }
    return;
  }

  const password = generatePassword();

  console.log("Creating GPU pod...");
  const startupScript = buildStartupScript(
    config.gpu.proxyPort,
    config.gpu.targetPort,
    config.gpu.entrypoint,
    config.customNodes,
    config.gpu.customNodesDir,
    config.gpu.preCommands,
  );

  const pod = await client.createPod({
    name: config.gpu.podName,
    imageName: config.gpu.image,
    computeType: "GPU",
    gpuTypeIds: config.gpu.typeIds,
    gpuCount: 1,
    networkVolumeId: volume.id,
    volumeMountPath: config.gpu.volumeMountPath,
    containerDiskInGb: 5,
    volumeInGb: 0,
    ports: [`${config.gpu.proxyPort}/http`],
    env: {
      ...config.gpu.env,
      AUTH_USERNAME,
      AUTH_PASSWORD: password,
    },
    dockerStartCmd: ["bash", "-c", startupScript],
  });
  console.log(`  Created: ${pod.id}`);

  console.log("Waiting for pod to start...");
  await waitForPodRunning(client, pod.id);

  const proxyUrl = getProxyUrl(pod.id, config.gpu.proxyPort);

  console.log("Waiting for service to be ready...");
  await waitForServiceReady(proxyUrl, AUTH_USERNAME, password);

  const authUrl = getAuthUrl(
    pod.id,
    config.gpu.proxyPort,
    AUTH_USERNAME,
    password,
  );
  console.log("");
  console.log("ComfyUI is ready!");
  console.log(`  URL: ${authUrl}`);
}
