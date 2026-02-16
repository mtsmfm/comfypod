# comfypod

CLI tool for running ComfyUI on RunPod with persistent model storage.

## Why?

Running ComfyUI on cloud GPUs has a few pain points:

- **GPU time is expensive** - Downloading models (often 10-50GB+) wastes expensive GPU hours
- **Data disappears** - Stopping a pod deletes everything, forcing re-downloads every session
- **Setup is repetitive** - Manually installing the same models and custom nodes each time
- **Security concerns** - RunPod proxy URLs have no built-in authentication

comfypod solves these by:

- Using cheap CPU pods for model downloads, storing them on a persistent Network Volume
- Keeping your models safe when GPU pods are stopped (pay only for storage)
- Defining your environment in a config file for reproducible setups
- Adding Basic Auth protection automatically

## Features

- Network volume for persistent model storage (pay only for storage when not using GPU)
- Automatic model downloading from HuggingFace and Civitai
- Custom node installation
- Basic auth protection for web UI

## Installation

```bash
npm install @mtsmfm/comfypod
```

## Setup

1. Create `comfypod.config.ts`:

```typescript
import { defineConfig } from "@mtsmfm/comfypod";

export default defineConfig({
  dataCenterId: "EU-CZ-1",
  gpu: {
    typeIds: ["NVIDIA GeForce RTX 3090"],
  },
  models: [
    {
      url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
      dest: "checkpoints/sd_xl_base_1.0.safetensors",
    },
  ],
  customNodes: [{ repo: "https://github.com/ltdrdata/ComfyUI-Manager" }],
});
```

Tokens default to environment variables (`RUNPOD_API_KEY`, `HF_TOKEN`, `CIVITAI_TOKEN`) but can be overridden in config.

## Usage

```bash
# Estimate network volume size needed
npx comfypod estimate

# Download models to network volume (uses cheap CPU pod)
npx comfypod setup

# Start GPU pod with ComfyUI
npx comfypod start

# Check status
npx comfypod status

# Stop and delete GPU pod (keeps network volume)
npx comfypod stop

# Delete everything including network volume
npx comfypod cleanup
```

### Options

```bash
npx comfypod <command> --config <path>
npx comfypod <command> -c <path>
```

## Configuration

| Option                 | Description              | Default                         |
| ---------------------- | ------------------------ | ------------------------------- |
| `dataCenterId`         | RunPod data center ID    | (required)                      |
| `tokens.runpodApiKey`  | RunPod API key           | `$RUNPOD_API_KEY`               |
| `tokens.hfToken`       | HuggingFace token        | `$HF_TOKEN`                     |
| `tokens.civitaiToken`  | Civitai token            | `$CIVITAI_TOKEN`                |
| `networkVolume.name`   | Network volume name      | `comfyui-models`                |
| `networkVolume.sizeGb` | Network volume size (GB) | `50`                            |
| `cpu.podName`          | CPU pod name             | `comfyui-downloader`            |
| `cpu.image`            | CPU pod Docker image     | `node:24-slim`                  |
| `cpu.flavorIds`        | CPU flavor IDs           | `["cpu3c"]`                     |
| `cpu.volumeMountPath`  | Volume mount path (CPU)  | `/workspace`                    |
| `gpu.podName`          | GPU pod name             | `comfyui-gpu`                   |
| `gpu.image`            | GPU pod Docker image     | `yanwk/comfyui-boot:cu128-slim` |
| `gpu.typeIds`          | GPU types to use         | (required)                      |
| `gpu.entrypoint`       | Entrypoint script        | `/runner-scripts/entrypoint.sh` |
| `gpu.proxyPort`        | Proxy port               | `80`                            |
| `gpu.targetPort`       | ComfyUI port             | `8188`                          |
| `gpu.volumeMountPath`  | Volume mount path (GPU)  | `/root/ComfyUI/models`          |
| `gpu.customNodesDir`   | Custom nodes directory   | `/root/ComfyUI/custom_nodes`    |
| `gpu.preCommands`      | Commands to run before entrypoint | `[]`                   |
| `gpu.env`              | Environment variables for GPU pod | `{ CLI_ARGS: "--cache-lru 0" }` |
| `models`               | Models to download       | `[]`                            |
| `customNodes`          | Custom nodes to install  | `[]`                            |

### Full Example

```typescript
import { defineConfig } from "@mtsmfm/comfypod";

export default defineConfig({
  dataCenterId: "EU-CZ-1",

  tokens: {
    runpodApiKey: "your-runpod-api-key",
    hfToken: "your-huggingface-token",
    civitaiToken: "your-civitai-token",
  },

  networkVolume: {
    name: "my-comfyui-models",
    sizeGb: 100,
  },

  cpu: {
    podName: "my-downloader",
    image: "node:24-slim",
    flavorIds: ["cpu3c"],
    volumeMountPath: "/workspace",
  },

  gpu: {
    podName: "my-comfyui",
    image: "yanwk/comfyui-boot:cu128-slim",
    typeIds: ["NVIDIA GeForce RTX 3090"],
    entrypoint: "/runner-scripts/entrypoint.sh",
    proxyPort: 80,
    targetPort: 8188,
    volumeMountPath: "/root/ComfyUI/models",
    customNodesDir: "/root/ComfyUI/custom_nodes",
    preCommands: ["echo 'Starting ComfyUI...'"],
    env: {
      CLI_ARGS: "--cache-lru 0",
    },
  },

  models: [
    {
      url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
      dest: "checkpoints/sd_xl_base_1.0.safetensors",
      sha256:
        "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
    },
  ],

  customNodes: [
    { repo: "https://github.com/ltdrdata/ComfyUI-Manager" },
    {
      repo: "https://github.com/cubiq/ComfyUI_IPAdapter_plus",
      name: "IPAdapter",
    },
  ],
});
```

## License

MIT
