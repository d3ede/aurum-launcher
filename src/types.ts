export type Loader = "vanilla" | "fabric" | "forge" | "neoforge" | "quilt";
export type Kind = "mod" | "modpack" | "shader" | "resourcepack";
export interface ProfileIconStyle {
  symbol: string;
  color: string;
  background: string;
}
export interface Content {
  id: string;
  source: string;
  projectId: string;
  versionId: string;
  name: string;
  filename: string;
  kind: Kind;
  enabled: boolean;
}
export interface Profile {
  id: string;
  name: string;
  minecraft: string;
  loader: Loader;
  loaderVersion: string | null;
  installedVersion: string | null;
  ramMb: number | null;
  jvmArgs: string;
  lastPlayed: number | null;
  cover: number;
  icon?: string | null;
  iconStyle?: ProfileIconStyle | null;
  content: Content[];
}
export interface Account {
  id: string;
  uuid: string;
  name: string;
  kind: "offline" | "microsoft";
  skinModel: "steve" | "alex";
  hasSkin: boolean;
}
export interface SavedSkin {
  id: string;
  name: string;
  model: "steve" | "alex";
  texture: string;
  capeId: string | null;
}
export interface SavedCape {
  id: string;
  name: string;
  texture: string;
  active?: boolean;
}
export interface SkinLibrary {
  skins: SavedSkin[];
  capes: SavedCape[];
  selections: Record<string, { skinId: string; capeId: string | null }>;
}
export interface AccountAppearance {
  texture: string;
  model: "steve" | "alex";
  capes: SavedCape[];
}
export interface ModrinthProfile {
  id: string;
  name: string;
  path: string;
  minecraft: string;
  loader: Loader;
  loaderVersion: string | null;
  icon: string | null;
  mods: number;
  worlds: number;
  issue: string | null;
  warnings: string[];
}
export interface ModrinthScan {
  profiles: ModrinthProfile[];
  directories: string[];
  warnings: string[];
}
export interface ModrinthImportResult {
  imported: Profile[];
  importedSources: string[];
  failed: { name: string; message: string }[];
  cancelled: boolean;
}
export interface Settings {
  language: string;
  theme: "light" | "dark" | "system";
  javaPath: string;
  ramMb: number;
  jvmArgs: string;
  resolutionWidth: number;
  resolutionHeight: number;
  showSnapshots: boolean;
}
export interface Snapshot {
  profiles: Profile[];
  accounts: Account[];
  selectedAccount: string | null;
  settings: Settings;
  dataDir: string;
  running: string[];
  curseforgeConfigured: boolean;
}
export interface Progress {
  id: string;
  profileId: string | null;
  phase: string;
  message: string;
  done: number;
  total: number;
}
export interface Project {
  id: string;
  source: "modrinth" | "curseforge";
  title: string;
  description: string;
  author: string;
  icon: string | null;
  downloads: number;
  kind: Kind;
}
export interface ProjectVersion {
  id: string;
  name: string;
  gameVersions: string[];
  loaders: string[];
}
export interface ProjectDetail {
  project: Project;
  body: string;
  gallery: string[];
  versions: ProjectVersion[];
  url: string;
}
export interface SearchQuery {
  query: string;
  source: "modrinth" | "curseforge";
  kind: Kind;
  minecraft: string | null;
  loader: string | null;
  offset: number;
  sort?: string;
  category?: string | null;
}
export interface CatalogTarget {
  profileId: string;
  kind: Kind;
}
export interface MinecraftManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string }[];
}
export type Route =
  "home" | "profiles" | "catalog" | "accounts" | "skins" | "settings";
