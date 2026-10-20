import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import type { Profile } from "../types";
import { t } from "../lib/i18n";
import { moveProfile, type ProfileOrder } from "../lib/profile-order";
import { ProfileCard } from "./ProfileCard";
import "./ProfileLibrary.css";

interface Drag {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  original: ProfileOrder;
  ids: string[];
  active: boolean;
  target: string | null;
  left: number;
  top: number;
  width: number;
  pointerX: number;
  pointerY: number;
}

export function ProfileLibrary({
  profiles,
  query,
  order,
  onOrder,
  onProfile,
}: {
  profiles: Profile[];
  query: string;
  order: ProfileOrder;
  onOrder: (order: ProfileOrder) => void;
  onProfile: (profile: Profile) => void;
}) {
  const drag = useRef<Drag | null>(null);
  const library = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { left: number; top: number }>());
  const [preview, setPreview] = useState<{
    id: string;
    target: string | null;
    left: number;
    top: number;
    width: number;
    x: number;
    y: number;
    settling?: boolean;
  } | null>(null);
  const visible = profiles.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const visibleKey = visible.map((profile) => profile.id).join(";");
  useLayoutEffect(() => {
    const next = new Map<string, { left: number; top: number }>();
    const rearranging = positions.current.size === visible.length;
    library.current
      ?.querySelectorAll<HTMLElement>("[data-profile-id]")
      .forEach((element) => {
        element.getAnimations().forEach((animation) => animation.cancel());
        const bounds = element.getBoundingClientRect();
        const previous = positions.current.get(element.dataset.profileId!);
        next.set(element.dataset.profileId!, {
          left: bounds.left,
          top: bounds.top,
        });
        if (
          previous &&
          rearranging &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches &&
          (previous.left !== bounds.left || previous.top !== bounds.top)
        ) {
          element.animate(
            [
              {
                transform: `translate(${previous.left - bounds.left}px, ${previous.top - bounds.top}px)`,
              },
              { transform: "translate(0, 0)" },
            ],
            { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
          );
        }
      });
    positions.current = next;
  }, [visibleKey]);
  useEffect(() => {
    if (!preview || preview.settling) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    let frame: number;
    const autoScroll = () => {
      const current = drag.current;
      if (!current?.active) return;
      const scroll = library.current?.closest<HTMLElement>(".content-scroll");
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        if (
          current.pointerX >= bounds.left &&
          current.pointerX <= bounds.right
        ) {
          const distance =
            current.pointerY < bounds.top + 48
              ? current.pointerY - bounds.top - 48
              : current.pointerY > bounds.bottom - 48
                ? current.pointerY - bounds.bottom + 48
                : 0;
          scroll.scrollTop += Math.max(-16, Math.min(16, distance / 5));
        }
      }
      const over = document
        .elementFromPoint(current.pointerX, current.pointerY)
        ?.closest<HTMLElement>("[data-profile-id]");
      const target =
        over && library.current?.contains(over)
          ? over.dataset.profileId || null
          : null;
      current.target = target;
      setPreview((previous) =>
        previous && !previous.settling && previous.target !== target
          ? { ...previous, target }
          : previous,
      );
      frame = requestAnimationFrame(autoScroll);
    };
    frame = requestAnimationFrame(autoScroll);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.cursor = previous;
    };
  }, [!!preview, preview?.settling]);

  function complete(current: Drag, cancel = false) {
    drag.current = null;
    if (!current.active) {
      setPreview(null);
      return;
    }
    const target = library.current?.querySelector<HTMLElement>(
      `[data-profile-id="${CSS.escape(cancel || !current.target ? current.id : current.target)}"]`,
    );
    const bounds = target?.getBoundingClientRect();
    const ghost = floating.current;
    let animation: Animation | undefined;
    if (
      ghost &&
      bounds &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      animation = ghost.animate(
        [
          { transform: getComputedStyle(ghost).transform },
          {
            transform: `translate3d(${bounds.left - current.left}px, ${bounds.top - current.top}px, 0)`,
          },
        ],
        { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
      );
      setPreview((previous) =>
        previous ? { ...previous, settling: true } : null,
      );
    } else setPreview(null);
    onOrder(
      cancel || !current.target
        ? current.original
        : {
            sort: "custom",
            ids: moveProfile(current.ids, current.id, current.target),
          },
    );
    if (animation)
      void animation.finished
        .catch(() => {})
        .then(() =>
          setPreview((previous) =>
            previous?.id === current.id && previous.settling ? null : previous,
          ),
        );
  }

  function finish(event: PointerEvent, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    complete(current, cancel);
  }

  return (
    <>
      <div
        ref={library}
        className="profile-grid library"
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.pointerX = event.clientX;
          current.pointerY = event.clientY;
          if (!current.active) {
            if (
              Math.hypot(event.clientX - current.x, event.clientY - current.y) <
              6
            )
              return;
            current.active = true;
            onOrder({ sort: "custom", ids: current.ids });
          }
          const card = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>("[data-profile-id]");
          current.target =
            card && event.currentTarget.contains(card)
              ? card.dataset.profileId || null
              : null;
          setPreview({
            id: current.id,
            target: current.target,
            left: current.left,
            top: current.top,
            width: current.width,
            x: event.clientX - current.x,
            y: event.clientY - current.y,
          });
        }}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !drag.current) return;
          event.preventDefault();
          const current = drag.current;
          complete(current, true);
        }}
      >
        {visible.map((profile) => (
          <div
            key={profile.id}
            data-profile-id={profile.id}
            className={`profile-sortable${preview?.id === profile.id ? " is-dragging" : ""}${preview?.target === profile.id && preview.id !== profile.id ? " is-drop-target" : ""}`}
          >
            <ProfileCard
              layout="row"
              profile={profile}
              onOpen={() => onProfile(profile)}
              reorderHandle={
                <button
                  type="button"
                  className="profile-sort-handle"
                  aria-label={t("Переместить сборку {{name}}", {
                    name: profile.name,
                  })}
                  title={t(
                    "Перетащите для сортировки. Стрелки — переместить с клавиатуры.",
                  )}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || !event.isPrimary || drag.current)
                      return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    floating.current
                      ?.getAnimations()
                      .forEach((animation) => animation.cancel());
                    const bounds = event.currentTarget
                      .closest<HTMLElement>("[data-profile-id]")!
                      .getBoundingClientRect();
                    drag.current = {
                      id: profile.id,
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      original: order,
                      ids: profiles.map((p) => p.id),
                      active: false,
                      target: null,
                      left: bounds.left,
                      top: bounds.top,
                      width: bounds.width,
                      pointerX: event.clientX,
                      pointerY: event.clientY,
                    };
                  }}
                  onKeyDown={(event) => {
                    if (drag.current) return;
                    const direction = ["ArrowUp", "ArrowLeft"].includes(
                      event.key,
                    )
                      ? -1
                      : ["ArrowDown", "ArrowRight"].includes(event.key)
                        ? 1
                        : 0;
                    if (!direction) return;
                    event.preventDefault();
                    const target =
                      visible[
                        visible.findIndex((p) => p.id === profile.id) +
                          direction
                      ];
                    if (target)
                      onOrder({
                        sort: "custom",
                        ids: moveProfile(
                          profiles.map((p) => p.id),
                          profile.id,
                          target.id,
                        ),
                      });
                  }}
                >
                  <GripVertical size={16} />
                </button>
              }
            />
          </div>
        ))}
      </div>
      {preview &&
        createPortal(
          <div
            ref={floating}
            className={`profile-drag-preview${preview.settling ? " is-settling" : ""}`}
            inert
            aria-hidden="true"
            style={
              {
                left: preview.left,
                top: preview.top,
                width: preview.width,
                transform: `translate3d(${preview.x}px, ${preview.y}px, 0)`,
                "--pattern-x": `${-preview.left}px`,
                "--pattern-y": `${80 - preview.top}px`,
              } as CSSProperties
            }
          >
            <ProfileCard
              layout="row"
              profile={profiles.find((profile) => profile.id === preview.id)!}
              onOpen={() => {}}
              reorderHandle={<GripVertical size={16} />}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
