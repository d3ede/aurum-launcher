import { useEffect, useRef, useState } from "react";
import { SkinViewer, IdleAnimation } from "skinview3d";
import { RotateCw } from "lucide-react";
import steveSkin from "../assets/skins/steve.png";
import alexSkin from "../assets/skins/alex.png";
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
  const [readyModel, setReadyModel] = useState("");
  useEffect(() => {
    if (!canvas.current) return;
    setError("");
    setReadyModel("");
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
        : model === "alex"
          ? alexSkin
          : steveSkin;
      void Promise.resolve(
        v.loadSkin(skin, { model: model === "alex" ? "slim" : "default" }),
      )
        .then(() => {
          if (alive) setReadyModel(model);
        })
        .catch((e: unknown) => {
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
          data-ready={readyModel === model}
          aria-busy={readyModel !== model}
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
