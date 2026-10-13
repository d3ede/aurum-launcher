import { useEffect, useRef, useState } from "react";
import { SkinViewer, IdleAnimation } from "skinview3d";
import { RotateCw } from "lucide-react";
export function defaultSkin(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#c8a382";
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = "#526f64";
  c.fillRect(16, 16, 24, 16);
  c.fillRect(16, 48, 16, 16);
  c.fillStyle = "#626c7d";
  c.fillRect(0, 16, 16, 16);
  c.fillRect(16, 48, 16, 16);
  c.fillStyle = "#705947";
  c.fillRect(8, 0, 16, 8);
  c.fillRect(0, 8, 8, 8);
  c.fillRect(24, 8, 8, 8);
  c.fillRect(8, 8, 8, 2);
  c.fillStyle = "#f4e8cd";
  c.fillRect(9, 11, 2, 1);
  c.fillRect(13, 11, 2, 1);
  c.fillStyle = "#394e45";
  c.fillRect(10, 11, 1, 1);
  c.fillRect(13, 11, 1, 1);
  c.clearRect(32, 0, 32, 16);
  c.clearRect(0, 32, 64, 16);
  c.clearRect(0, 48, 16, 16);
  c.clearRect(48, 48, 16, 16);
  return canvas;
}
export function SkinPreview({
  bytes,
  model,
}: {
  bytes: number[];
  model: "steve" | "alex";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const [rotate, setRotate] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!canvas.current) return;
    let v: SkinViewer | undefined;
    let url: string | undefined;
    let alive = true;
    try {
      v = new SkinViewer({
        canvas: canvas.current,
        width: 310,
        height: 350,
        zoom: 0.88,
      });
      viewer.current = v;
      v.animation = new IdleAnimation();
      v.autoRotate = rotate;
      v.autoRotateSpeed = 0.4;
      v.camera.position.set(25, 12, 60);
      const skin = bytes.length
        ? (url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          ))
        : defaultSkin();
      void Promise.resolve(
        v.loadSkin(skin, { model: model === "alex" ? "slim" : "default" }),
      ).catch((e: unknown) => {
        if (alive) setError(String(e));
      });
    } catch (e) {
      setError(`3D-превью недоступно: ${String(e)}`);
    }
    return () => {
      alive = false;
      v?.dispose();
      viewer.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [bytes, model]);
  useEffect(() => {
    if (viewer.current) viewer.current.autoRotate = rotate;
  }, [rotate]);
  return (
    <div className="skin-preview">
      <div className="skin-stage">
        <span className="skin-orbit" />
        <canvas
          ref={canvas}
          aria-label={`3D-превью модели ${model === "alex" ? "Alex" : "Steve"}`}
        />
        {error && <p role="alert">{error}</p>}
      </div>
      <button
        className="text-button"
        onClick={() => setRotate((v) => !v)}
        aria-pressed={rotate}
      >
        <RotateCw size={15} />
        {rotate ? "Остановить вращение" : "Вращать модель"}
      </button>
    </div>
  );
}
