import { describe, expect, it } from "vitest";
// @ts-expect-error Standalone Node build wrapper.
import { desktopArguments } from "../scripts/tauri.mjs";

describe("Social availability in desktop builds", () => {
  it("includes the exact offline runtime in local installers, before Rust arguments", () => {
    const args = desktopArguments(["build", "--no-sign", "--", "--locked"], {});
    const overlay = JSON.parse(args[args.indexOf("--config") + 1]);
    expect(overlay.bundle.resources).toEqual({
      "social-runtime/aurum-social-worker.exe":
        "social/aurum-social-worker.exe",
      "social-runtime/aurum-social-firewall.exe":
        "social/aurum-social-firewall.exe",
    });
    expect(args.slice(-2)).toEqual(["--", "--locked"]);
  });
  it("keeps published installers small and passes development commands through", () => {
    const args = ["build", "--no-sign"];
    expect(desktopArguments(args, { RELEASE_TAG: "v0.6.8" })).toEqual(args);
    expect(desktopArguments(["dev"], {})).toEqual(["dev"]);
  });
});
