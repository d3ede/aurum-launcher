import { useEffect, useRef, useState } from "react";
import {
  SkinViewer,
  IdleAnimation,
  WalkingAnimation,
  RunningAnimation,
  WaveAnimation,
  CrouchAnimation,
  HitAnimation,
} from "skinview3d";
import {
  Mesh,
  PlaneGeometry,
  CircleGeometry,
  MeshBasicMaterial,
  GridHelper,
  DoubleSide,
} from "three";
import { Move, RotateCcw } from "lucide-react";
import { t } from "../lib/i18n";
import steve from "../assets/skins/wide-steve.png";
import alex from "../assets/skins/slim-alex.png";
export type SkinMotion =
  "idle" | "still" | "walk" | "run" | "wave" | "crouch" | "hit";
export function SkinPreview({
  bytes,
  texture,
  model,
  cape,
  motion = "idle",
  className = "",
}: {
  bytes?: number[];
  texture?: string;
  model: "steve" | "alex";
  cape?: string | null;
  motion?: SkinMotion;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const reset = () => {
    const v = viewer.current;
    if (!v) return;
    const distance = v.camera.position.length();
    v.playerWrapper.rotation.set(0, 0, 0);
    v.camera.position
      .set(distance * 0.32, distance * 0.11, distance * 0.94)
      .setLength(distance);
    v.controls.target.set(0, -1, 0);
    v.controls.update();
  };
  useEffect(() => {
    let v: SkinViewer | null = null;
    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let ground: Mesh | null = null;
    let grid: GridHelper | null = null;
    let shadow: Mesh | null = null;
    try {
      v = new SkinViewer({
        canvas: canvas.current!,
        width: 340,
        height: 440,
        zoom: 0.85,
        pixelRatio: Math.min(devicePixelRatio, 2),
      });
      viewer.current = v;
      v.autoRotate = false;
      v.controls.enableZoom = false;
      v.controls.enablePan = false;
      v.controls.minPolarAngle = 0.35;
      v.controls.maxPolarAngle = Math.PI / 2;
      const groundMaterial = new MeshBasicMaterial({
        color: 0xe6e4d9,
        side: DoubleSide,
      });
      ground = new Mesh(new PlaneGeometry(140, 140), groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -16.05;
      v.scene.add(ground);
      grid = new GridHelper(140, 20, 0x777777, 0x777777);
      grid.position.y = -16.01;
      const materials = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      materials.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.12;
      });
      v.scene.add(grid);
      const shadowMaterial = new MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      });
      shadow = new Mesh(new CircleGeometry(7, 48), shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.set(1, 0.65, 1);
      shadow.position.y = -15.96;
      v.scene.add(shadow);
      const theme = () =>
        groundMaterial.color.set(
          document.documentElement.dataset.theme === "dark"
            ? 0x272e2b
            : 0xe8e5db,
        );
      theme();
      themeObserver = new MutationObserver(theme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      observer = new ResizeObserver(([entry]) => {
        if (v && entry.contentRect.width > 0)
          v.setSize(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(stage.current!);
      reset();
    } catch (e) {
      setError(t("3D-превью недоступно: {{v1}}", { v1: String(e) }));
    }
    return () => {
      observer?.disconnect();
      themeObserver?.disconnect();
      for (const object of [ground, grid, shadow])
        if (object) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((m) => m.dispose());
        }
      v?.dispose();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let live = true;
    setReady(false);
    setError("");
    let url: string | undefined;
    const src =
      texture ||
      (bytes?.length
        ? (url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          ))
        : model === "alex"
          ? alex
          : steve);
    const image = new Image();
    image.onload = () => {
      if (!live) return;
      try {
        v.loadSkin(image, { model: model === "alex" ? "slim" : "default" });
        setReady(true);
      } catch (e) {
        setError(String(e));
      }
    };
    image.onerror = () => {
      if (live) setError(t("Не удалось загрузить текстуру скина"));
    };
    image.src = src;
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [bytes, texture, model]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let live = true;
    v.loadCape(null);
    if (cape) {
      const image = new Image();
      image.onload = () => {
        if (live) v.loadCape(image);
      };
      image.onerror = () => {
        if (live) setError(t("Не удалось загрузить текстуру плаща"));
      };
      image.src = cape;
    }
    return () => {
      live = false;
    };
  }, [cape]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.animation =
      motion === "still"
        ? null
        : motion === "walk"
          ? new WalkingAnimation()
          : motion === "run"
            ? new RunningAnimation()
            : motion === "wave"
              ? new WaveAnimation()
              : motion === "crouch"
                ? new CrouchAnimation()
                : motion === "hit"
                  ? new HitAnimation()
                  : new IdleAnimation();
  }, [motion]);
  return (
    <div className={`skin-preview appearance-preview ${className}`}>
      <div className="skin-stage appearance-stage" ref={stage}>
        <canvas
          ref={canvas}
          data-ready={ready}
          data-auto-rotate="false"
          data-motion={motion}
          aria-busy={!ready}
          aria-label={t("Предпросмотр скина")}
        />
        {error && (
          <p className="appearance-render-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="skin-camera-controls">
        <span>
          <Move size={14} />
          {t("Перетащите, чтобы повернуть")}
        </span>
        <button
          className="icon-button"
          onClick={reset}
          aria-label={t("Сбросить ракурс")}
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
}
