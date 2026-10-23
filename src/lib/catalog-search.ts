import type { CatalogSource, Project, SearchQuery } from "../types";

type SearchResult = { projects: Project[]; total: number };
export type CatalogSearchSource = CatalogSource | "all";

export function searchSources(
  kind: string,
  minecraft: string | null,
): CatalogSource[] {
  if (kind !== "modpack") return ["modrinth", "curseforge"];
  // Technic search has no Minecraft-version filter. Do not return unfiltered packs.
  return [
    "modrinth",
    "curseforge",
    "atlauncher",
    "ftb",
    ...(!minecraft ? ["technic" as const] : []),
  ];
}

async function timedSearch<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Search timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function searchAllSources(
  query: Omit<SearchQuery, "source">,
  search: (query: SearchQuery) => Promise<SearchResult>,
  timeoutMs = 15000,
) {
  const sources = searchSources(query.kind, query.minecraft);
  const replies = await Promise.allSettled(
    sources.map((source) =>
      timedSearch(
        Promise.resolve().then(() =>
          search({ ...query, source, category: null, sort: "relevance" }),
        ),
        timeoutMs,
      ),
    ),
  );
  const pages: Project[][] = [];
  const failed: CatalogSource[] = [];
  let total = 0;
  let hasMore = false;
  replies.forEach((reply, index) => {
    if (reply.status === "rejected") {
      failed.push(sources[index]);
      return;
    }
    const page = reply.value;
    // Keep actual origin IDs: equally named projects on different services are distinct.
    pages.push(page.projects.filter((p) => p.source === sources[index]));
    total += page.total;
    hasMore ||= query.offset + 24 < page.total;
  });
  const projects: Project[] = [];
  const seen = new Set<string>();
  // Provider relevance scores cannot be compared. Interleave their ranked lists.
  const length = Math.max(0, ...pages.map((page) => page.length));
  for (let row = 0; row < length; row++) {
    for (const page of pages) {
      const project = page[row];
      if (!project) continue;
      const key = `${project.source}:${project.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        projects.push(project);
      }
    }
  }
  return {
    projects,
    total,
    hasMore,
    failed,
    allFailed: failed.length === sources.length,
  };
}
