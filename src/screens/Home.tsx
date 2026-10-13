import {
  Plus,
  ArrowRight,
  FolderOpen,
  Compass,
  Sprout,
  Sparkles,
  ShieldCheck,
  UserRound,
  Download,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { formatNumber } from "../lib/i18n";
import type { Profile, Project } from "../types";
import { Landscape } from "../components/Landscape";
import { ProfileCard } from "../components/ProfileCard";
import { ErrorBox, Loading } from "../components/ui";
export function Home({
  onProfile,
  onProject,
}: {
  onProfile: (p: Profile) => void;
  onProject: (p: Project) => void;
}) {
  const { data, navigate, create } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(native);
  const [retry, setRetry] = useState(0);
  const account = data.accounts.find((a) => a.id === data.selectedAccount);
  useEffect(() => {
    if (!native) return;
    let live = true;
    setLoading(true);
    rpc("search", {
      query: {
        query: "",
        source: "modrinth",
        kind: "mod",
        minecraft: null,
        loader: null,
        offset: 0,
      },
    })
      .then((r) => {
        if (live) {
          setProjects(r.projects.slice(0, 4));
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [retry]);
  const recent = [...data.profiles]
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
    .slice(0, 3);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ВАШЕ МЕСТО ДЛЯ MINECRAFT</div>
          <h1>
            {account
              ? `Привет, ${account.name}`
              : "Хороший день для нового мира"}
            <span className="heading-dot">.</span>
          </h1>
        </div>
        <span className="quiet-pill">
          <Sprout size={15} /> Всё начинается с идеи
        </span>
      </div>
      <section className="hero">
        <Landscape hero />
        <div className="hero-wash" />
        <div className="hero-content">
          <span className="hero-tag">
            <Sparkles size={14} /> Меньше настроек. Больше приключений.
          </span>
          <h2>
            Твои миры.
            <br />
            <span>Твои правила.</span>
          </h2>
          <p>
            Собери свой Minecraft: от уютного выживания
            <br className="desktop-break" /> до приключений с любимыми модами.
          </p>
          <button className="button primary" onClick={create}>
            <Plus size={17} /> Создать сборку <ArrowRight size={17} />
          </button>
        </div>
        <div className="hero-caption">
          <span className="caption-line" /> Ещё один мир ждёт тебя
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <h2>
              Мои сборки <span className="count">{data.profiles.length}</span>
            </h2>
            <p>Маленькие миры, большие истории</p>
          </div>
          <button className="text-button" onClick={() => navigate("profiles")}>
            Все сборки <ArrowRight size={16} />
          </button>
        </div>
        {recent.length ? (
          <div className="profile-grid">
            {recent.map((p) => (
              <ProfileCard key={p.id} profile={p} onOpen={() => onProfile(p)} />
            ))}
          </div>
        ) : (
          <div className="first-profile">
            <div className="first-profile-icon">
              <FolderOpen size={31} />
            </div>
            <div>
              <h3>Место для вашей первой сборки</h3>
              <p>
                Выберите версию игры и загрузчик. Остальное Auren возьмёт на
                себя.
              </p>
            </div>
            <button className="button secondary" onClick={create}>
              <Plus size={16} /> Создать сборку
            </button>
          </div>
        )}
      </section>
      <div className="home-bottom">
        <section className="section recommendations">
          <div className="section-heading">
            <div>
              <h2>Откройте что-то новое</h2>
              <p>Популярные проекты из Modrinth</p>
            </div>
            <button className="text-button" onClick={() => navigate("catalog")}>
              Каталог <ArrowRight size={16} />
            </button>
          </div>
          {loading ? (
            <Loading label="Получаем рекомендации Modrinth…" />
          ) : error ? (
            <ErrorBox error={error} retry={() => setRetry((v) => v + 1)} />
          ) : projects.length ? (
            <div className="recommended-list">
              {projects.map((p) => (
                <button
                  className="recommended-project"
                  key={p.id}
                  onClick={() => onProject(p)}
                >
                  {p.icon ? (
                    <img src={p.icon} alt="" loading="lazy" />
                  ) : (
                    <div className="project-placeholder">
                      <Compass size={22} />
                    </div>
                  )}
                  <div>
                    <b>{p.title}</b>
                    <p>{p.description}</p>
                    <small>
                      <Download size={12} /> {formatNumber(p.downloads)}{" "}
                      <span>· Modrinth</span>
                    </small>
                  </div>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <div className="catalog-placeholder">
              <Compass size={26} />
              <p>
                {native
                  ? "Пока нет рекомендаций"
                  : "Каталог подключается в desktop-приложении"}
              </p>
              <button
                className="text-button"
                onClick={() => navigate("catalog")}
              >
                Открыть каталог <ArrowRight size={15} />
              </button>
            </div>
          )}
        </section>
        <aside className="getting-started">
          <span className="eyebrow">НАЧНИТЕ С ПРОСТОГО</span>
          <h2>
            Всё готово
            <br />к вашим идеям.
          </h2>
          <button onClick={create}>
            <span>
              <FolderOpen size={18} />
            </span>
            <div>
              <b>Соберите свой мир</b>
              <small>Vanilla или любимый загрузчик</small>
            </div>
            <ArrowRight size={16} />
          </button>
          <button onClick={() => navigate("accounts")}>
            <span>
              <UserRound size={18} />
            </span>
            <div>
              <b>Добавьте аккаунт</b>
              <small>Microsoft или локальный профиль</small>
            </div>
            <ArrowRight size={16} />
          </button>
          <button onClick={() => navigate("settings")}>
            <span>
              <ShieldCheck size={18} />
            </span>
            <div>
              <b>Настройте под себя</b>
              <small>Память, Java и внешний вид</small>
            </div>
            <ArrowRight size={16} />
          </button>
          <div className="aside-note">
            <span className="status-dot" /> Каждый мир — отдельная папка
          </div>
        </aside>
      </div>
    </>
  );
}
