import {
  Plus,
  ArrowRight,
  Compass,
  Download,
  Play,
  Square,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { formatNumber, ru } from "../lib/i18n";
import type { Profile, Project } from "../types";
import { ProfileCard } from "../components/ProfileCard";
import { ProfileIcon } from "../components/ProfileIcon";
import { ErrorBox, Loading } from "../components/ui";
export function Home({
  onProfile,
  onProject,
}: {
  onProfile: (p: Profile) => void;
  onProject: (p: Project) => void;
}) {
  const { data, navigate, create, play, run, busy } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(native);
  const [retry, setRetry] = useState(0);
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
  const last = recent[0];
  const running = last && data.running.includes(last.id);
  return (
    <>
      <div className="page-heading heading-row">
        <h1>Главная</h1>
        <button className="button secondary" onClick={create}>
          <Plus size={18} /> Новая сборка
        </button>
      </div>
      <section className="quick-launch">
        <svg
          className="terrain-pattern"
          viewBox="0 0 1000 220"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <path
              key={i}
              d={`M ${370 + i * 18} -30 C ${240 + i * 35} 90, ${770 - i * 12} 5, ${610 + i * 33} 140 S ${830 + i * 25} 240, 1080 ${130 + i * 20}`}
            />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <path
              key={`b${i}`}
              d={`M ${770 + i * 25} -40 Q ${640 + i * 20} 90 ${910 + i * 18} 120 T 1100 280`}
            />
          ))}
        </svg>
        {last ? (
          <>
            <ProfileIcon profile={last} size={76} />
            <div className="quick-launch-info">
              <span>Быстрый запуск</span>
              <button onClick={() => onProfile(last)}>{last.name}</button>
              <p>
                Minecraft {last.minecraft} · {ru.loaders[last.loader]}
              </p>
            </div>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                running
                  ? void run(() => rpc("stop", { id: last.id }))
                  : void play(last)
              }
            >
              {running ? <Square size={18} /> : <Play size={18} />}
              {running ? "Остановить" : "Играть"}
            </button>
          </>
        ) : (
          <>
            <div className="quick-launch-info">
              <h2>Создайте первую сборку</h2>
              <p>Выберите версию Minecraft и загрузчик.</p>
            </div>
            <button className="button primary" onClick={create}>
              <Plus size={18} /> Создать сборку
            </button>
          </>
        )}
      </section>
      {recent.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <h2>Недавние сборки</h2>
            <button
              className="text-button"
              onClick={() => navigate("profiles")}
            >
              Все сборки <ArrowRight size={18} />
            </button>
          </div>
          <div className="profile-grid">
            {recent.map((p) => (
              <ProfileCard key={p.id} profile={p} onOpen={() => onProfile(p)} />
            ))}
          </div>
        </section>
      )}
      <section className="section recommendations">
        <div className="section-heading">
          <h2>Популярное в Modrinth</h2>
          <button className="text-button" onClick={() => navigate("catalog")}>
            Найти проекты <ArrowRight size={18} />
          </button>
        </div>
        {loading ? (
          <Loading label="Получаем проекты…" />
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
                  <Compass size={28} />
                )}
                <div>
                  <b>{p.title}</b>
                  <p>{p.description}</p>
                  <small>
                    <Download size={14} /> {formatNumber(p.downloads)}
                  </small>
                </div>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        ) : (
          <div className="catalog-placeholder">
            <Compass size={26} />
            <p>
              {native
                ? "Проекты не найдены"
                : "Каталог доступен в desktop-приложении"}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
