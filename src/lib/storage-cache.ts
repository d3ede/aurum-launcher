import type { StorageSnapshot } from "../screens/Storage";

interface Entry {
  snapshot: StorageSnapshot;
  signature: string;
  at: number;
}
interface Persistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const ttl = 60_000;
function valid(snapshot: StorageSnapshot) {
  return (
    snapshot &&
    Number.isFinite(snapshot.totalBytes) &&
    Number.isFinite(snapshot.cleanableBytes) &&
    typeof snapshot.gameDirectory === "string" &&
    [
      snapshot.categories,
      snapshot.profiles,
      snapshot.installations,
      snapshot.trash,
    ].every(Array.isArray)
  );
}
function browserStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function createStorageCache(
  storage: Persistence | undefined = browserStorage(),
  now = Date.now,
) {
  const entries = new Map<string, Entry>();
  const pending = new Map<
    string,
    { signature: string; promise: Promise<StorageSnapshot> }
  >();
  const latest = new Map<string, number>();
  let revision = 0;
  const storageKey = (key: string) =>
    `aurum:storage:v1:${encodeURIComponent(key)}`;
  function entry(key: string) {
    if (!entries.has(key)) {
      try {
        const saved = JSON.parse(
          storage?.getItem(storageKey(key)) || "null",
        ) as Entry | null;
        if (
          saved &&
          valid(saved.snapshot) &&
          Number.isFinite(saved.at) &&
          typeof saved.signature === "string" &&
          (!key || saved.snapshot.gameDirectory === key)
        )
          entries.set(key, saved);
      } catch {
        /* An unavailable or old cache never prevents reading disk usage. */
      }
    }
    return entries.get(key);
  }
  return {
    peek(key: string) {
      return entry(key)?.snapshot || null;
    },
    fresh(key: string, signature: string) {
      const saved = entry(key);
      return (
        !!saved &&
        saved.signature === signature &&
        now() >= saved.at &&
        now() - saved.at < ttl
      );
    },
    read(
      key: string,
      signature: string,
      load: () => Promise<StorageSnapshot>,
    ): Promise<StorageSnapshot> {
      const existing = pending.get(key);
      if (existing?.signature === signature) return existing.promise;
      const current = ++revision;
      latest.set(key, current);
      const promise = Promise.resolve()
        .then(load)
        .then((snapshot) => {
          if (!valid(snapshot)) throw new Error("Invalid storage snapshot");
          if (latest.get(key) === current) {
            const saved = { snapshot, signature, at: now() };
            entries.set(key, saved);
            try {
              storage?.setItem(storageKey(key), JSON.stringify(saved));
            } catch {
              /* Memory caching still works. */
            }
          }
          return snapshot;
        })
        .finally(() => {
          if (pending.get(key)?.promise === promise) pending.delete(key);
        });
      pending.set(key, { signature, promise });
      return promise;
    },
  };
}

export const storageCache = createStorageCache();
