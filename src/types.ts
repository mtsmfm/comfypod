import type { operations } from "./runpod-api.js";

type CreatePodInput =
  operations["CreatePod"]["requestBody"]["content"]["application/json"];

export type CpuFlavorId = NonNullable<CreatePodInput["cpuFlavorIds"]>[number];
export type GpuTypeId = NonNullable<CreatePodInput["gpuTypeIds"]>[number];

export interface Model {
  url: string;
  dest: string;
  sha256?: string;
}

export interface CustomNode {
  repo: string;
  name?: string;
}

export interface CpuConfigInput {
  podName?: string;
  image?: string;
  flavorIds?: CpuFlavorId[];
  volumeMountPath?: string;
}

export interface CpuConfig {
  podName: string;
  image: string;
  flavorIds: CpuFlavorId[];
  volumeMountPath: string;
}

export interface GpuConfigInput {
  podName?: string;
  image?: string;
  typeIds: GpuTypeId[];
  entrypoint?: string;
  proxyPort?: number;
  targetPort?: number;
  volumeMountPath?: string;
  customNodesDir?: string;
  preCommands?: string[];
  env?: Record<string, string>;
}

export interface GpuConfig {
  podName: string;
  image: string;
  typeIds: GpuTypeId[];
  entrypoint: string;
  proxyPort: number;
  targetPort: number;
  volumeMountPath: string;
  customNodesDir: string;
  preCommands: string[];
  env: Record<string, string>;
}

export interface NetworkVolumeConfigInput {
  name?: string;
  sizeGb?: number;
}

export interface NetworkVolumeConfig {
  name: string;
  sizeGb: number;
}

export interface Tokens {
  runpodApiKey?: string;
  hfToken?: string;
  civitaiToken?: string;
}

export interface ConfigInput {
  dataCenterId: string;
  tokens?: Tokens;
  networkVolume?: NetworkVolumeConfigInput;
  cpu?: CpuConfigInput;
  gpu: GpuConfigInput;
  models?: Model[];
  customNodes?: CustomNode[];
}

export interface Config {
  dataCenterId: string;
  tokens: Required<Tokens>;
  networkVolume: NetworkVolumeConfig;
  cpu: CpuConfig;
  gpu: GpuConfig;
  models: Model[];
  customNodes: CustomNode[];
}

const defaults = {
  tokens: {
    runpodApiKey: process.env.RUNPOD_API_KEY ?? "",
    hfToken: process.env.HF_TOKEN ?? "",
    civitaiToken: process.env.CIVITAI_TOKEN ?? "",
  },
  networkVolume: {
    name: "comfyui-models",
    sizeGb: 50,
  },
  cpu: {
    podName: "comfyui-downloader",
    image: "node:24-slim",
    flavorIds: ["cpu3c"] as CpuFlavorId[],
    volumeMountPath: "/workspace",
  },
  gpu: {
    podName: "comfyui-gpu",
    image: "yanwk/comfyui-boot:cu128-slim",
    entrypoint: "/runner-scripts/entrypoint.sh",
    proxyPort: 80,
    targetPort: 8188,
    volumeMountPath: "/root/ComfyUI/models",
    customNodesDir: "/root/ComfyUI/custom_nodes",
    env: {
      CLI_ARGS: "--cache-lru 0",
    } as Record<string, string>,
  },
};

export function defineConfig(input: ConfigInput): Config {
  return {
    dataCenterId: input.dataCenterId,
    tokens: {
      runpodApiKey: input.tokens?.runpodApiKey ?? defaults.tokens.runpodApiKey,
      hfToken: input.tokens?.hfToken ?? defaults.tokens.hfToken,
      civitaiToken: input.tokens?.civitaiToken ?? defaults.tokens.civitaiToken,
    },
    networkVolume: {
      name: input.networkVolume?.name ?? defaults.networkVolume.name,
      sizeGb: input.networkVolume?.sizeGb ?? defaults.networkVolume.sizeGb,
    },
    cpu: {
      podName: input.cpu?.podName ?? defaults.cpu.podName,
      image: input.cpu?.image ?? defaults.cpu.image,
      flavorIds: input.cpu?.flavorIds ?? defaults.cpu.flavorIds,
      volumeMountPath:
        input.cpu?.volumeMountPath ?? defaults.cpu.volumeMountPath,
    },
    gpu: {
      podName: input.gpu.podName ?? defaults.gpu.podName,
      image: input.gpu.image ?? defaults.gpu.image,
      typeIds: input.gpu.typeIds,
      entrypoint: input.gpu.entrypoint ?? defaults.gpu.entrypoint,
      proxyPort: input.gpu.proxyPort ?? defaults.gpu.proxyPort,
      targetPort: input.gpu.targetPort ?? defaults.gpu.targetPort,
      volumeMountPath:
        input.gpu.volumeMountPath ?? defaults.gpu.volumeMountPath,
      customNodesDir: input.gpu.customNodesDir ?? defaults.gpu.customNodesDir,
      preCommands: input.gpu.preCommands ?? [],
      env: { ...defaults.gpu.env, ...input.gpu.env },
    },
    models: input.models ?? [],
    customNodes: input.customNodes ?? [],
  };
}
