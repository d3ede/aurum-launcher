import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameReadySound } from "../src/lib/game-ready-sound";

const start = vi.fn();
const close = vi.fn(async () => {});
const disconnect = vi.fn();
const resume = vi.fn(async () => {});

class AudioFixture {
  state = "running";
  destination = {};
  close = close;
  resume = resume;
  decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
  createBufferSource = vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    disconnect,
    start,
    onended: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("AudioContext", AudioFixture);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());
const ready = (id = "launch-one") => ({
  id,
  profileId: "instance",
  phase: "game-ready",
});

describe("Minecraft readiness audio", () => {
  it("ignores process start and loading logs, and plays once per JVM session", async () => {
    const sound = new GameReadySound();
    await sound.unlock();
    for (const phase of ["running", "log", "loader", "crashed", "exited"])
      sound.handle({ ...ready(), phase });
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    sound.handle(ready());
    sound.handle(ready());
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    sound.handle(ready("launch-two"));
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(2);
    sound.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("never replays an old ready event after the user unlocks audio", async () => {
    const sound = new GameReadySound();
    sound.handle(ready());
    await sound.unlock();
    sound.handle(ready());
    sound.handle({ ...ready("invalid"), profileId: null });
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    sound.dispose();
  });

  it("does not play a queued sound after teardown or fail launch when audio fails", async () => {
    const sound = new GameReadySound();
    await sound.unlock();
    sound.handle(ready());
    sound.dispose();
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Audio unavailable");
      }),
    );
    const unavailable = new GameReadySound();
    await expect(unavailable.unlock()).resolves.toBeUndefined();
    unavailable.handle(ready("offline"));
    expect(start).not.toHaveBeenCalled();
    unavailable.dispose();
  });
});
