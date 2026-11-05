import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAllSources, searchSources } from "../src/lib/catalog-search";
import type { CatalogSource, Project, SearchQuery } from "../src/types";

const query: Omit<SearchQuery, "source"> = {
  query: "sodium",
  kind: "mod",
  minecraft: "1.21.1",
  loader: "fabric",
  offset: 0,
  category: "provider-category",
};
const project = (source: CatalogSource, id: string): Project => ({
  source,
  id,
  title: id,
  description: "",
  author: "",
  icon: null,
  downloads: 1,
  kind: "mod",
});
afterEach(() => vi.useRealTimers());

describe("combined catalog search", () => {
  it("queries only compatible providers and keeps strict Minecraft filtering", () => {
    expect(searchSources("mod", null)).toEqual(["modrinth", "curseforge"]);
    expect(searchSources("shader", null)).toHaveLength(2);
    expect(searchSources("resourcepack", null)).toHaveLength(2);
    expect(searchSources("modpack", null)).toHaveLength(5);
    expect(searchSources("modpack", "1.21.1")).not.toContain("technic");
  });
  it("interleaves provider rankings without merging unrelated IDs and uses per-provider pagination", async () => {
    const search = vi.fn(async (q: SearchQuery) => ({
      projects: [project(q.source, "same-id"), project(q.source, "second")],
      total: 24,
    }));
    const result = await searchAllSources(query, search);
    expect(result.projects.map((p) => `${p.source}:${p.id}`)).toEqual([
      "modrinth:same-id",
      "curseforge:same-id",
      "modrinth:second",
      "curseforge:second",
    ]);
    expect(result.hasMore).toBe(false); // Sum is 48, but neither provider has another page.
    expect(result.total).toBe(48);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][0]).toMatchObject({
      minecraft: "1.21.1",
      loader: "fabric",
      category: null,
      sort: "relevance",
    });
    const second = await searchAllSources(
      { ...query, offset: 24 },
      async (q) => ({ projects: [], total: q.source === "modrinth" ? 80 : 2 }),
    );
    expect(second.hasMore).toBe(true);
  });
  it("keeps successful results when one provider fails, with actionable source identities", async () => {
    const result = await searchAllSources(query, async (q) => {
      if (q.source === "curseforge") throw new Error("offline");
      return { projects: [project(q.source, "found")], total: 1 };
    });
    expect(result.projects).toHaveLength(1);
    expect(result.failed).toEqual(["curseforge"]);
    expect(result.allFailed).toBe(false);
    const failed = await searchAllSources(query, async () => {
      throw new Error("offline");
    });
    expect(failed.allFailed).toBe(true);
  });
  it("bounds a slow provider so it cannot leave the combined search hanging", async () => {
    vi.useFakeTimers();
    const work = searchAllSources(
      query,
      (q) =>
        q.source === "curseforge"
          ? new Promise(() => {})
          : Promise.resolve({
              projects: [project(q.source, "ready")],
              total: 1,
            }),
      50,
    );
    await vi.advanceTimersByTimeAsync(50);
    const result = await work;
    expect(result.projects).toHaveLength(1);
    expect(result.failed).toEqual(["curseforge"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
