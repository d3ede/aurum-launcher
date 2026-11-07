import { useCallback, useSyncExternalStore } from "react";
import { catalogSources } from "./catalog-sources";
import type { Project } from "../types";

export interface Favorite {
  project: Project;
  installedProfileId?: string;
}
export const favoriteKey = (project: Pick<Project, "source" | "id">) =>
  JSON.stringify([project.source, project.id]);
export const favoritesStorageKey = (dataDir: string) =>
  `aurum:favorites:${dataDir || "browser"}`;
export const favoriteLimit = 200;

export function decodeFavorites(value: string | null): Favorite[] {
  try {
    const parsed: unknown = JSON.parse(value || "null");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter((item): item is Favorite => {
        const p = item?.project;
        if (
          !p ||
          typeof p.id !== "string" ||
          !p.id ||
          p.id.length > 300 ||
          !Object.hasOwn(catalogSources, p.source) ||
          !["mod", "modpack", "shader", "resourcepack"].includes(p.kind) ||
          typeof p.title !== "string" ||
          typeof p.description !== "string" ||
          typeof p.author !== "string" ||
          !(p.icon === null || typeof p.icon === "string") ||
          !Number.isFinite(p.downloads) ||
          (item.installedProfileId !== undefined &&
            typeof item.installedProfileId !== "string")
        )
          return false;
        const key = favoriteKey(p);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, favoriteLimit);
  } catch {
    return [];
  }
}

const cache = new Map<string, Favorite[]>();
const listeners = new Set<() => void>();
function read(key: string) {
  let value = cache.get(key);
  if (!value) {
    try {
      value = decodeFavorites(localStorage.getItem(key));
    } catch {
      value = [];
    }
    cache.set(key, value);
  }
  return value;
}
function write(key: string, items: Favorite[]) {
  // Publish only after persistence succeeds; do not claim a failed save worked.
  localStorage.setItem(key, JSON.stringify(items));
  cache.set(key, items);
  listeners.forEach((listener) => listener());
}
export function useFavorites(dataDir: string) {
  const key = favoritesStorageKey(dataDir);
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      const changed = (event: StorageEvent) => {
        if (
          event.storageArea === localStorage &&
          (event.key === key || event.key === null)
        ) {
          cache.delete(key);
          listeners.forEach((notify) => notify());
        }
      };
      window.addEventListener("storage", changed);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", changed);
      };
    },
    [key],
  );
  const snapshot = useCallback(() => read(key), [key]);
  const items = useSyncExternalStore(subscribe, snapshot);
  const toggle = (project: Project) => {
    const current = read(key);
    const exists = current.some(
      (item) => favoriteKey(item.project) === favoriteKey(project),
    );
    if (!exists && current.length >= favoriteLimit)
      throw new Error("В избранном можно сохранить до 200 проектов.");
    write(
      key,
      exists
        ? current.filter(
            (item) => favoriteKey(item.project) !== favoriteKey(project),
          )
        : [...current, { project }],
    );
  };
  const installed = (project: Project, profileId: string) =>
    write(
      key,
      read(key).map((item) =>
        favoriteKey(item.project) === favoriteKey(project)
          ? { ...item, installedProfileId: profileId }
          : item,
      ),
    );
  return { items, toggle, installed };
}

export type FavoriteResult = {
  state: "installed" | "failed" | "cancelled";
  message?: string;
};
export async function runFavoriteQueue<T>(
  tasks: T[],
  signal: AbortSignal,
  install: (task: T) => Promise<void>,
  report: (task: T, result: FavoriteResult | { state: "installing" }) => void,
) {
  for (const task of tasks) {
    if (signal.aborted) break;
    report(task, { state: "installing" });
    try {
      await install(task);
      report(task, { state: "installed" });
    } catch (error) {
      report(task, {
        state: signal.aborted ? "cancelled" : "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (signal.aborted) break;
  }
}
