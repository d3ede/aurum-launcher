export interface SocialPrivacy {
  incomingRequests: boolean;
  shareActivity: boolean;
  publicRelays: boolean;
  invisible: boolean;
  notifications: boolean;
}
export interface SocialPerson {
  id: string;
  name: string;
  avatar?: string | null;
  state: "incoming" | "outgoing" | "friend" | "blocked";
  updated: number;
}
export interface SocialWorld {
  name: string;
  minecraft: string;
  loader: string;
  loaderVersion: string | null;
}
export interface SharedSource {
  provider: string;
  projectId: string;
  versionId: string;
}
export interface SharedFile {
  path: string;
  bytes: number;
  sha256: string;
  source: SharedSource | null;
  config: number[] | null;
}
export interface SharedManifest extends SocialWorld {
  version: number;
  files: SharedFile[];
}
export interface SocialOffer {
  id: string;
  expires: number;
  world: SocialWorld;
  manifestHash: string | null;
  manifestBytes: number;
  files: number;
  downloadBytes: number;
}
export interface SocialInvitation {
  from: string;
  offer: SocialOffer;
  manifest: SharedManifest | null;
  status: string;
  joinAddress: string | null;
}
export interface SocialPlanItem {
  path: string;
  name: string;
  bytes: number;
  sha256: string | null;
  sha1: string;
  source: SharedSource | null;
  url: string | null;
  page: string;
  config: number[] | null;
  required: boolean;
}
export interface SocialReview {
  id: string;
  plan: { world: SocialWorld; items: SocialPlanItem[]; warnings: string[] };
}
export interface SocialSnapshot {
  enabled: boolean;
  status: string;
  error: string | null;
  id: string | null;
  name: string;
  avatar: string | null;
  deliveries: Record<string, boolean>;
  contactLink: string | null;
  privacy: SocialPrivacy;
  people: SocialPerson[];
  online: string[];
  activity: Record<string, SocialWorld>;
  activeTunnels: number;
  invitations: SocialInvitation[];
}
export function socialSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
