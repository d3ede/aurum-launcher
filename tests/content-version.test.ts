import { describe, expect, it } from "vitest";
import { contentVersion } from "../src/lib/content-version";
describe("readable installed versions", () => {
  it("removes game and loader packaging tags in both Sodium and Iris formats", () => {
    expect(contentVersion("mc1.21.1-0.8.12-fabric", "1.21.1")).toBe("0.8.12");
    expect(contentVersion("1.8.7+1.21.1-fabric", "1.21.1")).toBe("1.8.7");
    expect(contentVersion("1.8.14-beta.1+1.21.1-fabric", "1.21.1")).toBe(
      "1.8.14 β1",
    );
  });
  it("keeps actual version numbers and meaningful prerelease/build qualifiers", () => {
    expect(contentVersion("1.21.1", "1.21.1")).toBe("1.21.1");
    expect(contentVersion("2.4.0", "1.21.1")).toBe("2.4.0");
    expect(contentVersion("v3.1.0-rc.2", "1.21.1")).toBe("3.1.0-rc.2");
    expect(contentVersion("0.4.2+build.16", "1.21.1")).toBe("0.4.2+build.16");
    expect(contentVersion("2026.3-release", "1.21.1")).toBe("2026.3");
    expect(contentVersion(undefined, "1.21.1")).toBe("");
  });
});
