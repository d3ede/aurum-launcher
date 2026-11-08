import readySoundUrl from "../assets/sounds/minecraft-ready.wav";
import type { Progress } from "../types";

/** One quiet cue per JVM session, only after the game's title-screen signal. */
export class GameReadySound {
  private context: AudioContext | null = null;
  private buffer: Promise<AudioBuffer> | null = null;
  private sessions = new Set<string>();
  private disposed = false;

  async unlock() {
    if (this.disposed) return;
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      this.buffer ??= fetch(readySoundUrl)
        .then((response) => {
          if (!response.ok) throw new Error("Game-ready sound is unavailable");
          return response.arrayBuffer();
        })
        .then((bytes) => context.decodeAudioData(bytes));
      // Start resuming synchronously in the launch button's user gesture.
      await Promise.all([context.resume(), this.buffer]);
    } catch {
      this.buffer = null;
    }
  }

  handle(event: Pick<Progress, "phase" | "id" | "profileId">) {
    if (
      this.disposed ||
      event.phase !== "game-ready" ||
      !event.id ||
      !event.profileId ||
      this.sessions.has(event.id)
    )
      return;
    if (this.sessions.size >= 256)
      this.sessions.delete(this.sessions.values().next().value!);
    this.sessions.add(event.id);
    const context = this.context;
    // Never queue a surprise sound to play when a later click unlocks audio.
    if (!context || context.state !== "running" || !this.buffer) return;
    void this.buffer
      .then((buffer) => {
        if (this.disposed || context.state !== "running") return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => source.disconnect();
        source.start();
      })
      .catch(() => {});
  }

  dispose() {
    this.disposed = true;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.buffer = null;
    this.sessions.clear();
  }
}
