import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../lib/i18n";

export function CatalogPagination({
  page,
  pages,
  loading,
  onPage,
}: {
  page: number;
  pages: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const [value, setValue] = useState(String(page));
  useEffect(() => setValue(String(page)), [page]);
  const jump = () => {
    const requested = Number(value);
    if (!value.trim() || !Number.isSafeInteger(requested)) {
      setValue(String(page));
      return;
    }
    const next = Math.min(pages, Math.max(1, requested));
    setValue(String(next));
    onPage(next);
  };
  return (
    <nav
      className="pagination catalog-pagination"
      aria-label={t("Страницы каталога")}
    >
      <button
        type="button"
        className="button secondary"
        aria-label={t("Предыдущая страница")}
        disabled={loading || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={16} />
        {t("Назад")}
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          jump();
        }}
      >
        <input
          aria-label={t("Номер страницы")}
          inputMode="numeric"
          value={value}
          disabled={loading}
          autoComplete="off"
          style={{
            width: `${Math.max(2, String(pages).length)}ch`,
          }}
          onChange={(event) => {
            const next = event.target.value;
            if (/^\d*$/.test(next))
              setValue(next === "" ? "" : String(Math.min(pages, Number(next))));
          }}
          onBlur={jump}
          onKeyDown={(event) => {
            if (event.key === "Escape") setValue(String(page));
          }}
        />
        <span aria-hidden="true">/</span>
        <span aria-label={t("Всего страниц: {{count}}", { count: pages })}>
          {pages}
        </span>
      </form>
      <button
        type="button"
        className="button secondary"
        aria-label={t("Следующая страница")}
        disabled={loading || page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {t("Вперёд")}
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
