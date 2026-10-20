import { describe, expect, it, vi, afterEach } from "vitest";
import {
  moveProfile,
  readProfileOrder,
  sortProfiles,
} from "../src/lib/profile-order";
import type { Profile } from "../src/types";

const profiles = [
  { id: "a", name: "Zulu", lastPlayed: 999 },
  { id: "b", name: "Alpha", lastPlayed: null },
  { id: "c", name: "Beta", lastPlayed: null },
] as Profile[];
const ids = (items: Profile[]) => items.map((p) => p.id);
afterEach(() => vi.unstubAllGlobals());

describe("library ordering", () => {
  it("puts newly added, never-played profiles first without mutating the snapshot", () => {
    expect(ids(sortProfiles(profiles, { sort: "recent", ids: [] }))).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(ids(profiles)).toEqual(["a", "b", "c"]);
  });

  it("keeps saved positions across renames, inserts new profiles first and ignores deleted IDs", () => {
    const order = { sort: "custom" as const, ids: ["deleted", "a", "b"] };
    expect(ids(sortProfiles(profiles, order))).toEqual(["c", "a", "b"]);
    expect(
      ids(
        sortProfiles(
          profiles.map((p) => ({ ...p, name: "Renamed" })),
          order,
        ),
      ),
    ).toEqual(["c", "a", "b"]);
    expect(ids(sortProfiles(profiles, { ...order, sort: "name" }))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("moves in both directions and preserves profiles hidden by search", () => {
    expect(moveProfile(["a", "hidden", "b", "c"], "a", "b")).toEqual([
      "hidden",
      "b",
      "a",
      "c",
    ]);
    expect(moveProfile(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveProfile(["a", "b"], "missing", "a")).toEqual(["a", "b"]);
  });

  it("recovers corrupt preferences and validates stored IDs", () => {
    const getItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem });
    getItem.mockReturnValue("invalid JSON");
    expect(readProfileOrder("test")).toEqual({ sort: "recent", ids: [] });
    getItem.mockReturnValue(
      JSON.stringify({ sort: "custom", ids: ["b", 1, null, "b", "a"] }),
    );
    expect(readProfileOrder("test")).toEqual({
      sort: "custom",
      ids: ["b", "a"],
    });
    getItem.mockReturnValue(JSON.stringify({ sort: "unknown", ids: {} }));
    expect(readProfileOrder("test")).toEqual({ sort: "recent", ids: [] });
  });
});
