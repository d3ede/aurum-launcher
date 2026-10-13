import { SkinViewer } from "skinview3d";
const cache = new Map<string, Promise<string>>();
let queue = Promise.resolve();
let renderer: SkinViewer | null = null;
let pending = 0;
export function skinThumbnail(texture: string, model: "steve" | "alex") {
  const key = `${model}:${texture}`;
  const existing = cache.get(key);
  if (existing) return existing;
  pending++;
  const job = queue
    .catch(() => {})
    .then(async () => {
      if (!renderer)
        renderer = new SkinViewer({
          width: 180,
          height: 230,
          zoom: 0.91,
          pixelRatio: 1,
          renderPaused: true,
          preserveDrawingBuffer: true,
          enableControls: false,
        });
      const v = renderer;
      await v.loadSkin(texture, {
        model: model === "alex" ? "slim" : "default",
      });
      const distance = v.camera.position.length();
      v.camera.position
        .set(distance * 0.24, distance * 0.04, distance * 0.97)
        .setLength(distance);
      v.camera.lookAt(0, 0, 0);
      // Use the same postprocessing/color pipeline as the large preview.
      v.render();
      return v.canvas.toDataURL("image/png");
    });
  const result = job.finally(() => {
    if (--pending === 0) {
      renderer?.dispose();
      renderer = null;
    }
  });
  queue = result.then(
    () => {},
    () => {},
  );
  cache.set(key, result);
  return result;
}
