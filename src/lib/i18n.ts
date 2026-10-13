import type { Kind, Loader, Route } from "../types";
// All shared navigation/domain strings live here; additional dictionaries can use the same keys.
export const ru = {
  routes: {
    home: "Главная",
    profiles: "Мои сборки",
    catalog: "Каталог проектов",
    accounts: "Аккаунты и скины",
    settings: "Настройки",
  } satisfies Record<Route, string>,
  loaders: {
    vanilla: "Vanilla",
    fabric: "Fabric",
    forge: "Forge",
    neoforge: "NeoForge",
    quilt: "Quilt",
  } satisfies Record<Loader, string>,
  kinds: {
    mod: "Моды",
    modpack: "Модпаки",
    shader: "Шейдеры",
    resourcepack: "Ресурспаки",
  } satisfies Record<Kind, string>,
  phases: {
    metadata: "Метаданные",
    java: "Java",
    libraries: "Библиотеки",
    assets: "Ресурсы игры",
    loader: "Загрузчик",
    content: "Контент",
    pack: "Модпак",
    import: "Импорт",
    auth: "Авторизация",
    "auth-code": "Вход в Microsoft",
  } as Record<string, string>,
};
export const formatNumber = (n: number) =>
  new Intl.NumberFormat("ru", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
