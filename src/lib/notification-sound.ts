export class NotificationSound {
  private context: AudioContext | null = null;

  unlock() {
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      /* Sound is optional when audio is unavailable. */
    }
  }

  play() {
    const context = this.context;
    if (context?.state !== "running") return;
    const note = context.createOscillator();
    const gain = context.createGain();
    note.type = "sine";
    note.frequency.value = 659.25;
    note.connect(gain);
    gain.connect(context.destination);
    const start = context.currentTime;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.035, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    note.start(start);
    note.stop(start + 0.18);
    note.onended = () => {
      note.disconnect();
      gain.disconnect();
    };
  }

  dispose() {
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
