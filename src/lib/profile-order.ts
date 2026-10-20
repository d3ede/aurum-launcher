import type { Profile } from "../types";

export type ProfileSort = "recent" | "name" | "custom";
export interface ProfileOrder {
  sort: ProfileSort;
  ids: string[];
}

export function readProfileOrder(key: string): ProfileOrder {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return {
      sort: ["recent", "name", "custom"].includes(saved?.sort)
        ? saved.sort
        : "recent",
      ids: Array.isArray(saved?.ids)
        ? [
            ...new Set<string>(
              saved.ids.filter((id: unknown) => typeof id === "string"),
            ),
          ]
        : [],
    };
  } catch {
    return { sort: "recent", ids: [] };
  }
}

export function sortProfiles(
  profiles: Profile[],
  order: ProfileOrder,
): Profile[] {
  // The database appends all newly created/imported profiles in creation order.
  const newest = [...profiles].reverse();
  if (order.sort === "recent") return newest;
  if (order.sort === "name")
    return newest.sort((a, b) => a.name.localeCompare(b.name));
  const ranks = new Map(order.ids.map((id, index) => [id, index]));
  // Newly added profiles precede the saved order; deleted IDs are harmless.
  return newest.sort(
    (a, b) => (ranks.get(a.id) ?? -1) - (ranks.get(b.id) ?? -1),
  );
}

export function moveProfile(
  ids: string[],
  source: string,
  target: string,
): string[] {
  const from = ids.indexOf(source);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
