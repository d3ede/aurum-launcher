export interface SocialPrivacy {
  incomingRequests: boolean;
  shareActivity: boolean;
  publicRelays: boolean;
}
export interface SocialPerson {
  id: string;
  name: string;
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
  contactLink: string | null;
  privacy: SocialPrivacy;
  people: SocialPerson[];
  online: string[];
  activity: Record<string, SocialWorld>;
  activeTunnels: number;
  invitations: SocialInvitation[];
}
