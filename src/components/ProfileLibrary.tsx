import { useRef, useState, type PointerEvent } from "react";
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
  const [preview, setPreview] = useState<{
    id: string;
    target: string | null;
  } | null>(null);
  const visible = profiles.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );

  function finish(event: PointerEvent, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setPreview(null);
    if (!current.active) return;
    onOrder(
      cancel || !current.target
        ? current.original
        : {
            sort: "custom",
            ids: moveProfile(
              current.ids,
              current.id,
              current.target || current.id,
            ),
          },
    );
  }

  return (
    <div
      className="profile-grid library"
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (!current.active) {
          if (
            Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6
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
        setPreview({ id: current.id, target: current.target });
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !drag.current) return;
        event.preventDefault();
        const current = drag.current;
        drag.current = null;
        setPreview(null);
        if (current.active) onOrder(current.original);
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
                  drag.current = {
                    id: profile.id,
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    original: order,
                    ids: profiles.map((p) => p.id),
                    active: false,
                    target: null,
                  };
                }}
                onKeyDown={(event) => {
                  if (drag.current) return;
                  const direction = ["ArrowUp", "ArrowLeft"].includes(event.key)
                    ? -1
                    : ["ArrowDown", "ArrowRight"].includes(event.key)
                      ? 1
                      : 0;
                  if (!direction) return;
                  event.preventDefault();
                  const target =
                    visible[
                      visible.findIndex((p) => p.id === profile.id) + direction
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
  );
}
