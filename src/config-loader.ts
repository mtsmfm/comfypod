import { createJiti } from "jiti";
import { existsSync } from "fs";
import { resolve } from "path";
import type { Config } from "./types.js";

const CONFIG_FILES = [
  "comfypod.config.ts",
  "comfypod.config.js",
  "comfypod.config.mjs",
];

export async function loadConfig(configPath?: string): Promise<Config> {
  const jiti = createJiti(import.meta.url);

  if (configPath) {
    const resolvedPath = resolve(configPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    const mod = await jiti.import(resolvedPath);
    return (mod as { default?: Config }).default ?? (mod as Config);
  }

  for (const file of CONFIG_FILES) {
    const filePath = resolve(process.cwd(), file);
    if (existsSync(filePath)) {
      const mod = await jiti.import(filePath);
      return (mod as { default?: Config }).default ?? (mod as Config);
    }
  }

  throw new Error(
    `Config file not found. Create one of: ${CONFIG_FILES.join(", ")}`,
  );
}
