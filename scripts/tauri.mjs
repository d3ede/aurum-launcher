import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Unpublished local builds cannot fetch their newly compiled runtime from a
// public release. Ship that exact runtime in local installers; the release
// workflow publishes the pinned download objects alongside its small installer.
export function desktopArguments(args, env = process.env) {
  if (!["build", "bundle"].includes(args[0]) || args.includes("--help"))
    return args;
  if (env.RELEASE_TAG) return args;
  const overlay = {
    bundle: {
      resources: {
        "social-runtime/aurum-social-worker.exe":
          "social/aurum-social-worker.exe",
        "social-runtime/aurum-social-firewall.exe":
          "social/aurum-social-firewall.exe",
      },
    },
  };
  const divider = args.indexOf("--");
  const at = divider < 0 ? args.length : divider;
  return [
    ...args.slice(0, at),
    "--config",
    JSON.stringify(overlay),
    ...args.slice(at),
  ];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("@tauri-apps/cli")), "tauri.js");
  const child = spawn(
    process.execPath,
    [cli, ...desktopArguments(process.argv.slice(2))],
    {
      stdio: "inherit",
    },
  );
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
