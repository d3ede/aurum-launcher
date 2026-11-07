import { Star } from "lucide-react";
import { useApp } from "../context";
import { useFavorites, favoriteKey } from "../lib/favorites";
import { t } from "../lib/i18n";
import type { Project } from "../types";

export function FavoriteButton({ project }: { project: Project }) {
  const { data, notify } = useApp();
  const { items, toggle } = useFavorites(data.dataDir);
  const active = items.some(
    (item) => favoriteKey(item.project) === favoriteKey(project),
  );
  const label = t(
    active ? "Убрать {{name}} из избранного" : "Добавить {{name}} в избранное",
    { name: project.title },
  );
  return (
    <button
      type="button"
      className={`favorite-button ${active ? "is-favorite" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={() => {
        try {
          toggle(project);
        } catch (error) {
          notify(
            t(
              error instanceof Error &&
                error.message === "В избранном можно сохранить до 200 проектов."
                ? "В избранном можно сохранить до 200 проектов."
                : "Не удалось сохранить избранное.",
            ),
            true,
          );
        }
      }}
    >
      <Star size={18} fill={active ? "currentColor" : "none"} />
    </button>
  );
}
