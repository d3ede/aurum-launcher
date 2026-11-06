import { t } from "./i18n";
import type { HorizonModStatus } from "./horizon-mods";
import type {
  SocialSnapshot,
  SocialPrivacy,
  SharedManifest,
  SocialReview,
} from "./social";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  HostingProfile,
  HostingSettings,
  HostingUpdate,
  HostingInspection,
  HostingConsole,
  HostingInstall,
} from "./hosting";
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
  RecentServer,
  ServerStatus,
  Project,
  ModrinthScan,
  ModrinthImportResult,
  ModrinthSkinImportResult,
  SavedSkin,
  SavedCape,
  SkinLibrary,
  AccountAppearance,
  PackOptions,
  PackRequirements,
} from "../types";
export const native = isTauri();
type Empty = Record<string, never>;
interface Contract {
  "social.takeLink": [Empty, string | null];
  "social.close": [Empty, void];
  "social.snapshot": [Empty, SocialSnapshot];
  "social.pending": [Empty, SocialReview[]];
  "social.enable": [{ accepted: boolean; name: string }, void];
  "social.disable": [Empty, void];
  "social.add": [{ input: string }, void];
  "social.relationship": [{ id: string; action: string }, void];
  "social.privacy": [{ privacy: SocialPrivacy }, void];
  "social.chooseAvatar": [Empty, boolean];
  "social.notify": [
    {
      kind: "request" | "invite";
      id: string;
      russian: boolean;
      silent: boolean;
    },
    boolean,
  ];
  "social.rename": [{ name: string }, void];
  "social.configureFirewall": [{ accepted: boolean }, void];
  "social.exportIdentity": [{ password: string }, boolean];
  "social.restoreIdentity": [{ password: string; replace: boolean }, boolean];
  "social.qr": [Empty, string];
  "social.lanListeners": [
    { profileId: string },
    { pid: number; creationTime: number; address: string }[],
  ];
  "social.exportManifest": [
    {
      profileId: string;
      configs: boolean;
      sensitive: boolean;
      operationId: string;
    },
    {
      manifest: SharedManifest;
      excluded: string[];
      potentialSecrets: string[];
    },
  ];
  "social.invite": [
    {
      profileId: string;
      friend: string;
      port: number | null;
      configs: boolean;
      sensitive: boolean;
      withPack: boolean;
      operationId: string;
    },
    void,
  ];
  "social.dismissInvite": [{ id: string }, void];
  "social.plan": [{ id: string; operationId: string }, SocialReview];
  "social.install": [
    { planId: string; operationId: string; accepted: boolean },
    { profileId: string; missing: number },
  ];
  "social.join": [{ id: string; profileId: string; operationId: string }, void];
  horizonModStatus: [{ id: string }, HorizonModStatus];
  horizonBuildLog: [{ id: string }, string];
  buildHorizonMods: [
    { id: string; operationId: string; trustNativeCode: boolean },
    void,
  ];
  accountSkinPreview: [{ id: string }, AccountAppearance];
  hostingProfiles: [Empty, HostingProfile[]];
  hostingFiles: [
    { id: string; path: string },
    {
      entries: { name: string; directory: boolean; bytes: number }[];
      truncated: boolean;
    },
  ];
  hostingScriptTrust: [
    { id: string },
    { path: string; hash: string; trusted: boolean },
  ];
  hostingTrustScript: [{ id: string; hash: string }, void];
  hostingNetworkScript: [{ id: string; script: string | null }, void];
  hostingNetworkStopCommand: [{ id: string; command: string }, void];
  hostingChooseFolder: [Empty, string | null];
  hostingInspect: [{ root: string }, HostingInspection];
  hostingImport: [{ root: string; selected: string[] }, HostingProfile[]];
  hostingSettings: [{ id: string }, HostingSettings];
  hostingUpdate: [{ id: string; update: HostingUpdate }, void];
  hostingRemove: [{ id: string }, void];
  hostingOpen: [{ id: string; logs: boolean }, void];
  hostingConsole: [{ id: string; after: number }, HostingConsole];
  hostingControl: [{ id: string; action: string; command?: string }, void];
  hostingPlayerAction: [
    { id: string; player: string; action: string; target?: string },
    void,
  ];
  hostingAcceptEula: [{ id: string; accepted: boolean }, void];
  hostingVersions: [{ core: string }, { version: string }[]];
  hostingInstall: [
    { operationId: string; request: HostingInstall },
    HostingProfile,
  ];
  hostingStart: [{ id: string; operationId: string }, void];
  hostingRestart: [{ id: string; operationId: string }, void];
  packRequirements: [
    {
      source: string;
      projectId: string;
      versionId: string;
      options: PackOptions;
    },
    PackRequirements,
  ];
  choosePackFile: [Empty, string | null];
  importPackManualFile: [{ id: string; path: string }, boolean];
  scanPackDownloads: [{ id: string; removeImported: boolean }, number];
  skinLibrary: [Empty, SkinLibrary];
  importModrinthSkins: [{ directories: string[] }, ModrinthSkinImportResult];
  accountAppearance: [{ id: string }, AccountAppearance];
  accountAvatar: [{ id: string }, string];
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
      removeSource?: boolean;
      operationId: string;
    },
    ModrinthImportResult,
  ];
  snapshot: [Empty, Snapshot];
  recentServers: [Empty, RecentServer[]];
  serverStatus: [{ id: string; force: boolean }, ServerStatus];
  removeRecentServer: [{ id: string }, void];
  createServerShortcut: [{ id: string }, string];
  takeServerShortcut: [Empty, { profileId: string; address: string } | null];
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
      engine?: "java" | "horizon";
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
      server?: string;
      skipHorizonMods?: boolean;
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
      options?: PackOptions;
    },
    string,
  ];
  importFolder: [
    {
      removeSource?: boolean;
      name: string;
      minecraft: string;
      loader: Loader;
      loaderVersion: string | null;
      operationId: string;
    },
    { id: string; sourceRemoved: boolean; warning: string | null } | null,
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
  uninstall: [Empty, void];
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
    const message =
      typeof e === "string"
        ? e
        : e instanceof Error
          ? e.message
          : t("Неизвестная ошибка");
    throw new Error(action.startsWith("social.") ? t(message) : message);
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
const savedBrowserSettings = (() => {
  try {
    return JSON.parse(
      localStorage.getItem("aurum:settings") || "null",
    ) as Settings | null;
  } catch {
    return null;
  }
})();
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
    ...savedBrowserSettings,
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
    (profile.engine === "horizon"
      ? kind === "mod" && version.loaders.includes("horizon")
      : kind !== "mod" ||
        (profile.loader !== "vanilla" &&
          version.loaders.includes(profile.loader)))
  );
}
export function searchKey(q: SearchQuery) {
  return JSON.stringify(q);
}
