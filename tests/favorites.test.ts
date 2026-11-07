import { describe, expect, it } from "vitest";
import {
  decodeFavorites,
  favoriteKey,
  favoritesStorageKey,
  runFavoriteQueue,
} from "../src/lib/favorites";
import type { Project } from "../src/types";
const project: Project = {
  id: "same-id",
  source: "modrinth",
  title: "Example",
  description: "A mod",
  author: "Author",
  icon: null,
  downloads: 12,
  kind: "mod",
};

describe("favorites", () => {
  it("preserves cross-source identity and installed pack receipts while rejecting damaged records", () => {
    const other = { ...project, source: "curseforge" as const };
    expect(favoriteKey(project)).not.toBe(favoriteKey(other));
    const items = [
      { project },
      { project: other, installedProfileId: "pack-profile" },
    ];
    expect(
      decodeFavorites(
        JSON.stringify([
          ...items,
          { project },
          { project: { ...project, source: "unknown" } },
          null,
        ]),
      ),
    ).toEqual(items);
    expect(decodeFavorites("broken JSON")).toEqual([]);
    expect(decodeFavorites('{"items":[]}')).toEqual([]);
    expect(favoritesStorageKey("D:/one")).not.toBe(
      favoritesStorageKey("D:/two"),
    );
  });
  it("installs sequentially and keeps going after an individual failure", async () => {
    const events: string[] = [];
    await runFavoriteQueue(
      [1, 2, 3],
      new AbortController().signal,
      async (item) => {
        events.push(`start:${item}`);
        await Promise.resolve();
        if (item === 2) throw new Error("Restricted download");
        events.push(`end:${item}`);
      },
      (item, result) => events.push(`${result.state}:${item}`),
    );
    expect(events).toEqual([
      "installing:1",
      "start:1",
      "end:1",
      "installed:1",
      "installing:2",
      "start:2",
      "failed:2",
      "installing:3",
      "start:3",
      "end:3",
      "installed:3",
    ]);
  });
  it("does not start another task after cancellation, even if the current task succeeds", async () => {
    const controller = new AbortController();
    const installed: number[] = [];
    await runFavoriteQueue(
      [1, 2, 3],
      controller.signal,
      async (item) => {
        installed.push(item);
        controller.abort();
      },
      () => {},
    );
    expect(installed).toEqual([1]);
    const results: string[] = [];
    const cancelled = new AbortController();
    await runFavoriteQueue(
      [1, 2],
      cancelled.signal,
      async () => {
        cancelled.abort();
        throw new Error("Cancelled");
      },
      (_, result) => results.push(result.state),
    );
    expect(results).toEqual(["installing", "cancelled"]);
  });
});
