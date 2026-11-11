import type { Progress } from "../types";
import type { LauncherPreferences } from "./launcher-preferences";

interface LauncherWindow {
  minimize(): Promise<void>;
  unminimize(): Promise<void>;
  setFocus(): Promise<void>;
}

export class LauncherWindowBehavior {
  private running = new Set<string>();
  private queue = Promise.resolve();

  constructor(
    private window: LauncherWindow,
    private preferences: () => LauncherPreferences,
  ) {}

  seed(profiles: string[]) {
    profiles.forEach((profile) => this.running.add(profile));
  }

  handle(event: Pick<Progress, "phase" | "profileId">): Promise<void> {
    if (!event.profileId) return Promise.resolve();
    const settings = this.preferences();
    let action: (() => Promise<void>) | undefined;
    if (event.phase === "running") {
      if (this.running.has(event.profileId)) return Promise.resolve();
      this.running.add(event.profileId);
      if (settings.minimizeOnLaunch) action = () => this.window.minimize();
    } else if (event.phase === "exited" || event.phase === "crashed") {
      if (!this.running.delete(event.profileId)) return Promise.resolve();
      if (settings.restoreOnExit && !this.running.size)
        action = async () => {
          await this.window.unminimize();
          await this.window.setFocus();
        };
    }
    if (!action) return Promise.resolve();
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
}
