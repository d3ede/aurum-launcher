import type { ProfileIconStyle } from "../types";

export interface HostingProfile {
  id: string;
  name: string;
  description: string;
  root: string;
  directory: string;
  entrypoint: string;
  core: string;
  version: string;
  javaMajor: number;
  javaPath: string;
  ramMb: number;
  jvmArgs: string;
  icon: ProfileIconStyle;
  launches: number;
  lastStarted: number | null;
  network?: {
    components: string[];
    startupScript: string | null;
    trustedHash?: string | null;
    stopCommand?: string;
  } | null;
}
export interface HostingSettings {
  port: number;
  bind: string;
  onlineMode: boolean;
  maxPlayers: number;
  motd: string;
}
export type HostingUpdate = Pick<
  HostingProfile,
  | "name"
  | "description"
  | "javaMajor"
  | "javaPath"
  | "ramMb"
  | "jvmArgs"
  | "icon"
> & { settings: HostingSettings };
export interface HostingInspection {
  root: string;
  candidates: {
    id: string;
    name: string;
    directory: string;
    entrypoint: string;
    core: string;
    version: string;
    javaMajor: number;
  }[];
  warnings: string[];
  networks?: { directory: string; componentIds: string[] }[];
  startupScripts?: string[];
}
export interface HostingLive {
  status:
    "starting" | "running" | "stopping" | "stopped" | "crashed" | "external";
  pid: number | null;
  startedAt: number | null;
  cpu: number | null;
  memoryBytes: number | null;
  players: string[];
  playerCount: number | null;
  maxPlayers: number | null;
  exitCode: number | null;
}
export interface HostingLine {
  sequence: number;
  time: number;
  level: string;
  message: string;
}
export interface HostingConsole {
  lines: HostingLine[];
  latest: number;
  truncated: boolean;
  live: HostingLive;
}
export interface HostingInstall {
  name: string;
  core: string;
  version: string;
  acceptEula: boolean;
  experimental: boolean;
  ramMb: number;
}
export const hostingCores: Record<string, string> = {
  network: "Сеть серверов",
  custom: "JAR",
  paper: "Paper",
  folia: "Folia",
  velocity: "Velocity",
  vanilla: "Vanilla",
  spigot: "Spigot",
  purpur: "Purpur",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt",
  bungeecord: "BungeeCord",
  waterfall: "Waterfall",
};
export const hostingStatuses = {
  starting: "Запускается",
  running: "Запущен",
  stopping: "Останавливается",
  stopped: "Остановлен",
  crashed: "Ошибка запуска",
  external: "Запущен вне Aurum",
};
export const activeHost = (live?: HostingLive) =>
  !!live && ["starting", "running", "stopping"].includes(live.status);
export const isProxy = (core: string) =>
  ["velocity", "bungeecord", "waterfall"].includes(core);

export function formatHostingPath(root: string, relative = ".") {
  const clean = root.startsWith("\\\\?\\UNC\\")
    ? `\\\\${root.slice(8)}`
    : root.startsWith("\\\\?\\")
      ? root.slice(4)
      : root;
  const windows = /^[a-z]:[\\/]/i.test(clean) || clean.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  const path =
    relative && relative !== "."
      ? `${clean.replace(/[\\/]$/, "")}${separator}${relative}`
      : clean;
  return windows ? path.replace(/\//g, "\\") : path;
}

export function hostingMotdText(value: string) {
  return value
    .replace(/<[^>\r\n]{1,250}>/g, "")
    .replace(/[§&](?:#[0-9a-f]{6}|[0-9a-fk-orx])/gi, "")
    .replace(/\\n/g, "\n");
}
