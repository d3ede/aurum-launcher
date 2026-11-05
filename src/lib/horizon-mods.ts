import type { Content } from "../types";
export interface HorizonModStatus {
  mods: Content[];
  enabled: number;
  needsBuild: boolean;
  hasBuild: boolean;
  builtAt: number | null;
  error: string | null;
}
