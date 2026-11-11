import type { Settings } from "../types";

/** Keep edits across page changes and merge them with the latest saved settings. */
export class SettingsAutosave {
  private pending: Partial<Settings> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving = false;
  private active = true;
  private failed = false;
  private due = 0;

  constructor(
    private current: () => Settings,
    private canSave: () => boolean,
    private save: (settings: Settings) => Promise<boolean>,
  ) {}

  update(patch: Partial<Settings>, delay = 450) {
    this.pending = { ...this.pending, ...patch };
    this.failed = false;
    this.due = Date.now() + delay;
    this.resume();
  }

  flush() {
    this.due = 0;
    this.failed = false;
    return this.persist();
  }

  resume() {
    clearTimeout(this.timer);
    if (
      !this.active ||
      this.failed ||
      this.saving ||
      !Object.keys(this.pending).length
    )
      return;
    this.timer = setTimeout(
      () => void this.persist(),
      Math.max(0, this.due - Date.now()),
    );
  }

  start() {
    this.active = true;
    this.resume();
  }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
  }

  private async persist() {
    clearTimeout(this.timer);
    if (!this.active || this.saving || !this.canSave()) return;
    const latest = this.current();
    const patch = Object.fromEntries(
      Object.entries(this.pending).filter(
        ([key, value]) => latest[key as keyof Settings] !== value,
      ),
    ) as Partial<Settings>;
    this.pending = {};
    if (!Object.keys(patch).length) return;
    this.saving = true;
    let saved = false;
    try {
      saved = await this.save({ ...latest, ...patch });
    } finally {
      this.saving = false;
      if (!saved) {
        const newerEdits = Object.keys(this.pending).length > 0;
        this.pending = { ...patch, ...this.pending };
        this.failed = !newerEdits;
        if (newerEdits) this.resume();
      } else this.resume();
    }
  }
}
