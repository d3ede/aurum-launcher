import { useState } from "react";
import {
  Plus,
  Download,
  Search,
  FolderOpen,
  ArrowDownWideNarrow,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import type { Profile } from "../types";
import { ProfileCard } from "../components/ProfileCard";
import { EmptyState } from "../components/ui";
export function Profiles({
  onProfile,
  onFolderImport,
}: {
  onProfile: (p: Profile) => void;
  onFolderImport: () => void;
}) {
  const { data, create, operation, busy } = useApp();
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
            <h1>Мои сборки</h1>
            <p>Моды, миры и настройки каждой сборки хранятся отдельно.</p>
          </div>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void operation(
                  (id) => rpc("importPack", { operationId: id }),
                  "Сборка импортирована",
                )
              }
            >
              <Download size={16} /> Импорт .mrpack / ZIP
            </button>
            <button className="button primary" onClick={create}>
              <Plus size={17} /> Новая сборка
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
            placeholder="Найти свою сборку"
            aria-label="Поиск сборок"
          />
        </div>
        <div className="select-icon">
          <ArrowDownWideNarrow size={16} />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Сортировка сборок"
          >
            <option value="recent">Сначала недавние</option>
            <option value="name">По названию</option>
          </select>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={onFolderImport}
        >
          <FolderOpen size={16} /> Импорт папки игры
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
          title={query ? "Сборка не найдена" : "Нет сборок"}
          text={
            query
              ? "Попробуйте другое название."
              : "Создайте новую сборку или импортируйте модпак. Игра и загрузчик установятся перед первым запуском."
          }
        >
          <button className="button primary" onClick={create}>
            <Plus size={16} /> Создать сборку
          </button>
        </EmptyState>
      )}
      <p className="page-footnote">
        Удалённые сборки сохраняются в корзине Aurum. Открыть её можно из папки
        данных в настройках.
      </p>
    </>
  );
}
