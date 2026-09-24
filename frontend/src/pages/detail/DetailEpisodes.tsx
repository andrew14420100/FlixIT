// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { MAIN_PATH } from "src/constant";
import { episodeStillUrl } from "./useEpisodes";
import { warmPlayback } from "./detailUtils";
import "./detail-episodes.css";

function SeasonSelect({ seasons, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dp-season" ref={ref}>
      <button
        type="button"
        className="dp-season__btn"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="detail-season-select"
      >
        <span>Stagione {value}</span>
        <KeyboardArrowDownRoundedIcon className={`dp-season__chevron${open ? " is-open" : ""}`} />
      </button>
      {open ? (
        <ul className="dp-season__menu" role="listbox" aria-label="Seleziona stagione" data-testid="detail-season-menu">
          {seasons.map((season) => {
            const number = Number(season.season_number);
            return (
              <li
                key={number}
                role="option"
                aria-selected={number === value}
                className={`dp-season__item${number === value ? " is-active" : ""}`}
                onClick={() => {
                  onChange(number);
                  setOpen(false);
                }}
                data-testid={`detail-season-option-${number}`}
              >
                <span>Stagione {number}</span>
                {season.episode_count ? <span className="dp-season__count">{season.episode_count} ep.</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function episodeState(episodeNumber, seasonNumber, progressItem, currentSeason, currentEpisode) {
  if (!progressItem) return { kind: "none" };
  if (seasonNumber < currentSeason || (seasonNumber === currentSeason && episodeNumber < currentEpisode)) {
    return { kind: "done" };
  }
  if (seasonNumber === currentSeason && episodeNumber === currentEpisode) {
    const duration = Number(progressItem.duration || 0);
    const progress = Number(progressItem.progress || 0);
    if (duration > 0 && progress > 0) {
      return {
        kind: "progress",
        percent: Math.min(100, Math.max(3, (progress / duration) * 100)),
        remainingMinutes: Math.max(1, Math.ceil(Math.max(0, duration - progress) / 60)),
      };
    }
  }
  return { kind: "none" };
}

export default function DetailEpisodes({ mediaId, data, episodesState }) {
  const navigate = useNavigate();
  const { progressItem, hasRealProgress, season: currentSeason, episode: currentEpisode, backdropUrl } = data;
  const { seasons, selected, setSelected, episodes, loadingSeasons, loadingEpisodes } = episodesState;
  const realProgressItem = hasRealProgress ? progressItem : null;

  const play = (episodeNumber) => {
    warmPlayback("tv", mediaId, selected, episodeNumber);
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/tv/${mediaId}?s=${selected}&e=${episodeNumber}`);
  };

  return (
    <div className="dp-episodes" data-testid="detail-episodes">
      <div className="dp-episodes__head">
        <h2 className="dp-episodes__title">Episodi</h2>
        {seasons.length ? <SeasonSelect seasons={seasons} value={selected} onChange={setSelected} /> : null}
      </div>

      {!seasons.length ? (
        <div className="dp-card dp-empty" data-testid="detail-episodes-empty">
          {loadingSeasons ? "Caricamento stagioni…" : "Nessun episodio disponibile in italiano al momento."}
        </div>
      ) : (
        <div className="dp-episodes__list" data-testid="detail-episodes-list">
          {episodes.map((episode) => {
            const number = Number(episode.episode_number);
            const state = episodeState(number, selected, realProgressItem, currentSeason, currentEpisode);
            const still = episodeStillUrl(episode.still_path) || backdropUrl;
            const runtime = Number(episode.runtime || 0);
            const runtimeLabel = runtime ? `${runtime} min` : "";
            const onKey = (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                play(number);
              }
            };
            return (
              <article
                key={number}
                className={`dp-episode${state.kind !== "none" ? ` is-${state.kind}` : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`Riproduci episodio ${number}${episode.name ? `: ${episode.name}` : ""}`}
                onClick={() => play(number)}
                onMouseEnter={() => warmPlayback("tv", mediaId, selected, number)}
                onKeyDown={onKey}
                data-testid={`detail-episode-${selected}-${number}`}
              >
                <div className="dp-episode__thumb">
                  {still ? <img src={still} alt="" loading="lazy" decoding="async" /> : null}
                </div>

                <div className="dp-episode__body">
                  <span className="dp-episode__num">{String(number).padStart(2, "0")}</span>
                  <h3 className="dp-episode__name">{episode.name || `Episodio ${number}`}</h3>
                  {episode.overview ? <p className="dp-episode__desc">{episode.overview}</p> : null}
                </div>

                <div className="dp-episode__status">
                  {state.kind === "done" ? (
                    <>
                      <span className="dp-episode__done"><CheckCircleRoundedIcon /> Completato</span>
                      <div className="dp-episode__bar-row">
                        <div className="dp-progress is-done"><div className="dp-progress__fill" style={{ width: "100%" }} /></div>
                        <span className="dp-episode__runtime">{runtimeLabel}</span>
                      </div>
                    </>
                  ) : null}

                  {state.kind === "progress" ? (
                    <>
                      <div className="dp-episode__bar-row">
                        <div className="dp-progress"><div className="dp-progress__fill" style={{ width: `${state.percent}%` }} /></div>
                        <span className="dp-episode__runtime">{runtimeLabel}</span>
                      </div>
                      <span className="dp-episode__remaining"><b>{state.remainingMinutes}</b> min rimanenti</span>
                    </>
                  ) : null}

                  {state.kind === "none" ? <span className="dp-episode__runtime dp-episode__runtime--solo">{runtimeLabel}</span> : null}
                </div>
              </article>
            );
          })}

          {!episodes.length ? (
            <div className="dp-card dp-empty" data-testid="detail-episodes-season-empty">
              {loadingEpisodes ? "Verifica doppiaggio italiano…" : "Nessun episodio doppiato in italiano disponibile in questa stagione."}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
