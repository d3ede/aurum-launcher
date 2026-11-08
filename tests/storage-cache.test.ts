import { describe, expect, it } from "vitest";
import { createStorageCache } from "../src/lib/storage-cache";
import type { StorageSnapshot } from "../src/screens/Storage";

const directory = "C:/Aurum/Game Files";
function snapshot(bytes: number): StorageSnapshot {
  return {
    totalBytes: bytes,
    cleanableBytes: 0,
    gameDirectory: directory,
    launcherDirectory: "C:/Aurum/Launcher",
    categories: [],
    profiles: [],
    installations: [],
    trash: [],
    browserCleanupPending: false,
  };
}
function persistence() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("storage snapshot cache", () => {
  it("shares an in-flight disk scan across mounts", async () => {
    const cache = createStorageCache(persistence(), () => 100);
    let calls = 0;
    let resolve!: (value: StorageSnapshot) => void;
    const load = () => {
      calls++;
      return new Promise<StorageSnapshot>((done) => {
        resolve = done;
      });
    };
    const a = cache.read(directory, "profiles", load);
    const b = cache.read(directory, "profiles", load);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolve(snapshot(10));
    expect(await a).toEqual(await b);
    expect(cache.peek(directory)?.totalBytes).toBe(10);
    expect(cache.fresh(directory, "profiles")).toBe(true);
  });

  it("restores the last result after restart, but expires its freshness and separates data locations", async () => {
    const disk = persistence();
    let now = 1000;
    await createStorageCache(disk, () => now).read(
      directory,
      "profile-v1",
      async () => snapshot(42),
    );
    const restarted = createStorageCache(disk, () => now);
    expect(restarted.peek(directory)?.totalBytes).toBe(42);
    expect(restarted.fresh(directory, "profile-v1")).toBe(true);
    expect(restarted.fresh(directory, "profile-v2")).toBe(false);
    now += 60_001;
    expect(restarted.fresh(directory, "profile-v1")).toBe(false);
    expect(restarted.peek(directory)?.totalBytes).toBe(42);
    expect(restarted.peek("D:/Other/Game Files")).toBeNull();
  });

  it("keeps the displayed result after a failed scan and allows retrying", async () => {
    const cache = createStorageCache(persistence());
    await cache.read(directory, "profile", async () => snapshot(12));
    await expect(
      cache.read(directory, "profile", async () => {
        throw new Error("disk unavailable");
      }),
    ).rejects.toThrow("disk unavailable");
    expect(cache.peek(directory)?.totalBytes).toBe(12);
    await cache.read(directory, "profile", async () => snapshot(15));
    expect(cache.peek(directory)?.totalBytes).toBe(15);
  });

  it("does not let an older scan overwrite a newer profile state", async () => {
    const cache = createStorageCache(persistence());
    let old!: (value: StorageSnapshot) => void,
      current!: (value: StorageSnapshot) => void;
    const a = cache.read(
      directory,
      "old",
      () =>
        new Promise((done) => {
          old = done;
        }),
    );
    const b = cache.read(
      directory,
      "current",
      () =>
        new Promise((done) => {
          current = done;
        }),
    );
    await Promise.resolve();
    current(snapshot(20));
    await b;
    old(snapshot(10));
    await a;
    expect(cache.peek(directory)?.totalBytes).toBe(20);
    expect(cache.fresh(directory, "current")).toBe(true);
  });
});
