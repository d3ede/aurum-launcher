import { t } from "../lib/i18n";
import { useState } from "react";
import { Plus, Search, FolderOpen, ArrowDownWideNarrow } from "lucide-react";
import { useApp } from "../context";
import { Select } from "../components/Select";

import type { Profile } from "../types";
import { ProfileCard } from "../components/ProfileCard";
import { EmptyState } from "../components/ui";
import { ImportProfileButton } from "../components/ImportProfileButton";
export function Profiles({
  onProfile,
  onFolderImport,
}: {
  onProfile: (p: Profile) => void;
  onFolderImport: () => void;
}) {
  const { data, create, busy } = useApp();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const profiles = data.profiles
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "ru")
        : (b.lastPlayed || 0) - (a.lastPlayed || 0),
    );
  return (
    <>
      <div className="page-heading">
        <div className="heading-row">
          <div>
            <h1>{t("Мои сборки")}</h1>
            <p>
              {t("Моды, миры и настройки каждой сборки хранятся отдельно.")}
            </p>
          </div>
          <div className="button-row">
            <ImportProfileButton onFolderImport={onFolderImport} />
            <button className="button primary" onClick={create}>
              <Plus size={17} />
              {t(" Новая сборка")}
            </button>
          </div>
        </div>
      </div>
      <div className="toolbar">
        <div className="input-icon">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Найти свою сборку")}
            aria-label={t("Поиск сборок")}
          />
        </div>
        <div className="select-icon">
          <ArrowDownWideNarrow size={16} />
          <Select
            value={sort}
            onValueChange={setSort}
            aria-label={t("Сортировка сборок")}
            options={[
              { value: "recent", label: t("Сначала недавние") },
              { value: "name", label: t("По названию") },
            ]}
          />
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={onFolderImport}
        >
          <FolderOpen size={16} />
          {t(" Импорт папки игры")}
        </button>
      </div>
      {profiles.length ? (
        <div className="profile-grid library">
          {profiles.map((p) => (
            <ProfileCard key={p.id} profile={p} onOpen={() => onProfile(p)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderOpen size={34} />}
          title={query ? t("Сборка не найдена") : t("Нет сборок")}
          text={
            query
              ? t("Попробуйте другое название.")
              : t(
                  "Создайте новую сборку — Minecraft установится сразу. Или импортируйте готовую сборку.",
                )
          }
        >
          <button className="button primary" onClick={create}>
            <Plus size={16} />
            {t(" Создать сборку")}
          </button>
        </EmptyState>
      )}
      <p className="page-footnote">
        {t(
          "Удалённые сборки сохраняются в корзине Aurum. Открыть её можно из папки данных в настройках.",
        )}
      </p>
    </>
  );
}
