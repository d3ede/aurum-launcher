import { useEffect, useRef } from "react";
import { native, rpc } from "../lib/api";
import type { Account } from "../types";
import steve from "../assets/skins/wide-steve.png";
import alex from "../assets/skins/slim-alex.png";

const requests = new WeakMap<Account, Promise<string>>();

function loadImage(texture: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.width !== 64 || ![32, 64].includes(image.height)) {
        reject(new Error("Invalid skin dimensions"));
      } else resolve(image);
    };
    image.onerror = reject;
    image.src = texture;
  });
}

export function AccountAvatar({
  account,
  size = 32,
}: {
  account: Account;
  size?: 32 | 40;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const rendered = useRef<{
    accountId: string;
    image: HTMLImageElement;
  } | null>(null);
  useEffect(() => {
    let live = true;
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!context || !element) return;
    const head = document.createElement("canvas");
    head.width = head.height = 8;
    const headContext = head.getContext("2d");
    if (!headContext) return;
    const paint = () => {
      if (!live) return;
      const ratio = window.devicePixelRatio || 1;
      const pixels =
        size === 32
          ? Math.round(size * ratio)
          : 8 * Math.round((size * ratio) / 8);
      element.width = element.height = Math.max(8, pixels);
      const displaySize = size === 32 ? size : pixels / ratio;
      element.style.width = element.style.height = `${displaySize}px`;
      context.imageSmoothingEnabled = false;
      context.drawImage(head, 0, 0, element.width, element.height);
    };
    window.addEventListener("resize", paint);
    delete element.dataset.headReady;
    const fallback = account.skinModel === "alex" ? alex : steve;
    let request = requests.get(account);
    if (!request) {
      request =
        native && (account.kind === "microsoft" || account.hasSkin)
          ? rpc("accountAvatar", { id: account.id }).catch(() => fallback)
          : Promise.resolve(fallback);
      requests.set(account, request);
    }
    const draw = (image: HTMLImageElement) => {
      if (!live) return;
      rendered.current = { accountId: account.id, image };
      headContext.clearRect(0, 0, 8, 8);
      headContext.imageSmoothingEnabled = false;
      headContext.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
      headContext.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
      paint();
      element.dataset.headReady = "true";
    };
    const previous =
      rendered.current?.accountId === account.id
        ? rendered.current.image
        : null;
    if (previous) draw(previous);
    void (async () => {
      if (!previous) draw(await loadImage(fallback));
      const texture = await request;
      if (texture !== fallback || previous) draw(await loadImage(texture));
    })().catch(() => {});
    return () => {
      live = false;
      window.removeEventListener("resize", paint);
    };
  }, [account, size]);
  return (
    <span className="account-skin-head" aria-hidden="true">
      <canvas
        ref={canvas}
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    </span>
  );
}
