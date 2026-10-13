import { describe, it, expect } from "vitest";
import { compatible, searchKey } from "../src/lib/api";
import type { Profile } from "../src/types";
const profile: Profile = {
  id: "test",
  name: "test",
  minecraft: "1.21.1",
  loader: "fabric",
  loaderVersion: "0.16.0",
  installedVersion: null,
  ramMb: null,
  jvmArgs: "",
  lastPlayed: null,
  cover: 0,
  content: [],
};
describe("Installation compatibility", () => {
  it("requires the exact game version and loader for mods", () => {
    expect(
      compatible(
        { gameVersions: ["1.21.1"], loaders: ["fabric"] },
        profile,
        "mod",
      ),
    ).toBe(true);
    expect(
      compatible(
        { gameVersions: ["1.21"], loaders: ["fabric"] },
        profile,
        "mod",
      ),
    ).toBe(false);
    expect(
      compatible(
        { gameVersions: ["1.21.1"], loaders: ["forge"] },
        profile,
        "mod",
      ),
    ).toBe(false);
    expect(
      compatible(
        { gameVersions: ["1.21.1"], loaders: ["vanilla"] },
        { ...profile, loader: "vanilla" },
        "mod",
      ),
    ).toBe(false);
  });
  it("accepts resource packs independent of a mod loader", () => {
    expect(
      compatible(
        { gameVersions: ["1.21.1"], loaders: ["minecraft"] },
        profile,
        "resourcepack",
      ),
    ).toBe(true);
  });
  it("keeps source and paging distinct in search cache keys", () => {
    const query = {
      query: "Sodium",
      source: "modrinth" as const,
      kind: "mod" as const,
      minecraft: "1.21.1",
      loader: "fabric",
      offset: 0,
    };
    expect(searchKey(query)).not.toBe(
      searchKey({ ...query, source: "curseforge" }),
    );
    expect(searchKey(query)).not.toBe(searchKey({ ...query, offset: 24 }));
  });
});
