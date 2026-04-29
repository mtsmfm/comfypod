import { chmodSync, readdirSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { release } from "os";
import notifier, { type Notification } from "node-notifier";

function isWSL(): boolean {
  return (
    process.platform === "linux" &&
    release().toLowerCase().includes("microsoft")
  );
}

function walkExes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkExes(full));
    else if (entry.name.endsWith(".exe")) out.push(full);
  }
  return out;
}

let prepared = false;
function ensureExesExecutable() {
  if (prepared || !isWSL()) {
    prepared = true;
    return;
  }
  const require = createRequire(import.meta.url);
  const vendorDir = join(dirname(require.resolve("node-notifier")), "vendor");
  for (const exe of walkExes(vendorDir)) {
    try {
      chmodSync(exe, 0o755);
    } catch {}
  }
  prepared = true;
}

export function notify(options: Notification) {
  ensureExesExecutable();
  notifier.notify(options);
}
