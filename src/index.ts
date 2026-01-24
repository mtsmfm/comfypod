#!/usr/bin/env node
import { Command } from "commander";
import { setup } from "./commands/setup.js";
import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { cleanup } from "./commands/cleanup.js";
import { status } from "./commands/status.js";
import { estimate } from "./commands/estimate.js";
import { loadConfig } from "./config-loader.js";
import type { Config } from "./types.js";

export { defineConfig } from "./types.js";
export type {
  Config,
  Model,
  CustomNode,
  NetworkVolumeConfig,
  CpuConfig,
  GpuConfig,
  CpuFlavorId,
  GpuTypeId,
  Tokens,
} from "./types.js";

const program = new Command();

program
  .name("comfypod")
  .description("CLI tool for managing ComfyUI on RunPod")
  .option("-c, --config <path>", "path to config file");

function createCommand(
  name: string,
  description: string,
  action: (config: Config) => Promise<void>,
) {
  program
    .command(name)
    .description(description)
    .action(async () => {
      const config = await loadConfig(program.opts().config);
      await action(config);
    });
}

createCommand(
  "setup",
  "Set up network volume with models and custom nodes",
  setup,
);
createCommand("start", "Start the pod", start);
createCommand("stop", "Stop the pod", stop);
createCommand("cleanup", "Clean up resources", cleanup);
createCommand("status", "Show pod status", status);
createCommand("estimate", "Estimate network volume size needed", estimate);

program.parse();
