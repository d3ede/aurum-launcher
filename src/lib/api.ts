import { t } from "./i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Account,
  Content,
  ContentInspection,
  ContentUpdateResult,
  Loader,
  MinecraftManifest,
  Profile,
  Progress,
  ProjectDetail,
  SearchQuery,
  SearchQuery as Query,
  Settings,
  Snapshot,
  Project,
  ModrinthScan,
  ModrinthImportResult,
  SavedSkin,
  SavedCape,
  SkinLibrary,
  AccountAppearance,
} from "../types";
export const native = isTauri();
type Empty = Record<string, never>;
interface Contract {
  skinLibrary: [Empty, SkinLibrary];
  accountAppearance: [{ id: string }, AccountAppearance];
  defaultSkinTexture: [{ id: string; model: string }, number[]];
  chooseSkinTexture: [
    { cape: boolean },
    { name: string; bytes: number[] } | null,
  ];
  saveLibrarySkin: [
    {
      id: string | null;
      name: string;
      model: string;
      bytes: number[];
      capeId: string | null;
    },
    SavedSkin,
  ];
  saveLibraryCape: [{ name: string; bytes: number[] }, SavedCape];
  deleteLibraryItem: [{ id: string; cape: boolean }, void];
  applyLibrarySkin: [
    { accountId: string; skinId: string; model: string; capeId: string | null },
    void,
  ];
  scanModrinth: [
    {
      directories: string[];
    },
    ModrinthScan,
  ];
  chooseModrinthDirectory: [Empty, string | null];
  importModrinth: [
    {
      directories: string[];
      selected: string[];
      operationId: string;
    },
    ModrinthImportResult,
  ];
  snapshot: [Empty, Snapshot];
  versions: [Empty, MinecraftManifest];
  loaders: [
    {
      minecraft: string;
      loader: Loader;
    },
    string[],
  ];
  createProfile: [
    {
      name: string;
      minecraft: string;
      loader: Loader;
      loaderVersion: string | null;
      cover: number;
      icon?: string | null;
      iconStyle?: Profile["iconStyle"];
    },
    Profile,
  ];
  updateProfile: [
    {
      profile: Profile;
    },
    void,
  ];
  chooseProfileIcon: [Empty, string | null];
  catalogCategories: [
    {
      source: string;
      kind: string;
    },
    {
      id: string;
      name: string;
    }[],
  ];
  deleteProfile: [
    {
      id: string;
    },
    void,
  ];
  saveSettings: [
    {
      settings: Settings;
    },
    void,
  ];
  setCurseforgeKey: [
    {
      key: string;
    },
    void,
  ];
  addOffline: [
    {
      name: string;
    },
    Account,
  ];
  selectAccount: [
    {
      id: string;
    },
    void,
  ];
  deleteAccount: [
    {
      id: string;
    },
    void,
  ];
  skin: [
    {
      id: string;
    },
    number[],
  ];
  setSkin: [
    {
      id: string;
      model: string;
    },
    boolean | null,
  ];
  chooseJava: [Empty, string | null];
  checkJava: [
    {
      path: string;
    },
    number,
  ];
  search: [
    {
      query: Query;
    },
    {
      projects: Project[];
      total: number;
    },
  ];
  project: [
    {
      source: string;
      id: string;
      minecraft?: string;
      loader?: string;
    },
    ProjectDetail,
  ];
  content: [
    {
      id: string;
    },
    Content[],
  ];
  inspectContent: [{ id: string }, ContentInspection];
  updateAllContent: [
    { id: string; contentIds: string[]; operationId: string },
    ContentUpdateResult,
  ];
  manageContent: [
    {
      id: string;
      contentId: string;
      action: "toggle" | "remove";
    },
    void,
  ];
  importContent: [
    {
      id: string;
      kind: string;
    },
    void,
  ];
  launch: [
    {
      id: string;
    },
    void,
  ];
  stop: [
    {
      id: string;
    },
    void,
  ];
  cancel: [
    {
      operationId: string;
    },
    void,
  ];
  install: [
    {
      id: string;
      operationId: string;
    },
    void,
  ];
  installContent: [
    {
      id: string;
      source: string;
      projectId: string;
      versionId: string;
      operationId: string;
    },
    void,
  ];
  updateContent: [
    {
      id: string;
      contentId: string;
      operationId: string;
    },
    void,
  ];
  importPack: [
    {
      operationId: string;
    },
    string | null,
  ];
  downloadPack: [
    {
      source: string;
      projectId: string;
      versionId: string;
      operationId: string;
    },
    string,
  ];
  importFolder: [
    {
      name: string;
      minecraft: string;
      loader: Loader;
      loaderVersion: string | null;
      operationId: string;
    },
    string | null,
  ];
  loginMicrosoft: [
    {
      operationId: string;
    },
    Account,
  ];
  reopenMicrosoft: [
    {
      operationId: string;
    },
    void,
  ];
  openFolder: [
    {
      id?: string;
    },
    void,
  ];
  changeDataDirectory: [
    {
      operationId: string;
    },
    string | null,
  ];
  restart: [Empty, never];
  openUrl: [
    {
      url: string;
    },
    void,
  ];
  logs: [
    {
      id: string;
    },
    string,
  ];
}
export async function rpc<K extends keyof Contract>(
  action: K,
  payload: Contract[K][0],
): Promise<Contract[K][1]> {
  if (!native)
    throw new Error(
      t(
        "Эта функция доступна в desktop-приложении Aurum. Запустите npm run tauri dev.",
      ),
    );
  try {
    return await invoke<Contract[K][1]>("rpc", { action, payload });
  } catch (e) {
    throw new Error(
      typeof e === "string"
        ? e
        : e instanceof Error
          ? e.message
          : t("Неизвестная ошибка"),
    );
  }
}
export async function events(callback: (event: Progress) => void) {
  if (!native) return () => {};
  return listen<Progress>("auren:event", (event) => callback(event.payload));
}
export const defaultSettings: Settings = {
  language: "system",
  theme: "light",
  javaPath: "",
  ramMb: 4096,
  jvmArgs: "",
  resolutionWidth: 1280,
  resolutionHeight: 720,
  showSnapshots: false,
};
const savedTheme =
  typeof localStorage !== "undefined"
    ? localStorage.getItem("auren:theme")
    : null;
export const browserSnapshot: Snapshot = {
  profiles: [],
  accounts: [],
  selectedAccount: null,
  settings: {
    ...defaultSettings,
    theme:
      savedTheme && ["light", "dark", "system"].includes(savedTheme)
        ? (savedTheme as Settings["theme"])
        : "light",
  },
  dataDir: "",
  running: [],
  curseforgeConfigured: false,
};
export function compatible(
  version: {
    gameVersions: string[];
    loaders: string[];
  },
  profile: Profile,
  kind: string,
) {
  return (
    version.gameVersions.includes(profile.minecraft) &&
    (kind !== "mod" ||
      (profile.loader !== "vanilla" &&
        version.loaders.includes(profile.loader)))
  );
}
export function searchKey(q: SearchQuery) {
  return JSON.stringify(q);
}
