import { t } from "../lib/i18n";
import { useState } from "react";
import { Plus, Search, FolderOpen, ArrowDownWideNarrow } from "lucide-react";
import { useApp } from "../context";
import { Select } from "../components/Select";

import type { Profile } from "../types";
import { ProfileLibrary } from "../components/ProfileLibrary";
import {
  readProfileOrder,
  sortProfiles,
  type ProfileOrder,
  type ProfileSort,
} from "../lib/profile-order";
import { EmptyState } from "../components/ui";
import { ImportProfileButton } from "../components/ImportProfileButton";
export function Profiles({
  onProfile,
  onFolderImport,
}: {
  onProfile: (p: Profile) => void;
  onFolderImport: () => void;
}) {
  const { data, create, busy, notify } = useApp();
  const [query, setQuery] = useState("");
  const storageKey = `aurum:profile-order:${data.dataDir}`;
  const [order, setOrder] = useState(() => readProfileOrder(storageKey));
  const profiles = sortProfiles(data.profiles, order);
  const hasMatches = profiles.some((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );
  function saveOrder(next: ProfileOrder) {
    setOrder(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      notify(t("Не удалось сохранить порядок сборок"), true);
    }
  }
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
            value={order.sort}
            onValueChange={(sort) =>
              saveOrder({ ...order, sort: sort as ProfileSort })
            }
            aria-label={t("Сортировка сборок")}
            options={[
              { value: "recent", label: t("Сначала новые") },
              { value: "name", label: t("По названию") },
              { value: "custom", label: t("Пользовательская") },
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
      {hasMatches ? (
        <ProfileLibrary
          profiles={profiles}
          query={query}
          order={order}
          onOrder={saveOrder}
          onProfile={onProfile}
        />
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
