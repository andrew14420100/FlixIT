// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { MAIN_PATH } from "src/constant";
import useEpisodes, { episodeStillUrl } from "./useEpisodes";
import { warmPlayback } from "./detailUtils";

function SeasonSelect({ seasons, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="fxd-season" ref={ref}>
      <button type="button" className="fxd-season__btn" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} data-testid="detail-season-select">
        <span>Stagione {value}</span>
        <KeyboardArrowDownRoundedIcon />
      </button>
      {open ? (
        <ul className="fxd-season__menu" role="listbox" data-testid="detail-season-menu">
          {seasons.map((season) => (
            <li
              key={season.season_number}
              role="option"
              aria-selected={Number(season.season_number) === value}
              className={`fxd-season__item${Number(season.season_number) === value ? " is-active" : ""}`}
              onClick={() => { onChange(Number(season.season_number)); setOpen(false); }}
              data-testid={`detail-season-option-${season.season_number}`}
            >
              Stagione {season.season_number}
              {season.episode_count ? <span className="fxd-season__count">{season.episode_count} ep.</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function episodeState(episode, seasonNumber, progressItem, currentSeason, currentEpisode) {
  const number = Number(episode.episode_number);
  if (!progressItem) return { kind: "none" };
  if (seasonNumber < currentSeason || (seasonNumber === currentSeason && number < currentEpisode)) return { kind: "done" };
  if (seasonNumber === currentSeason && number === currentEpisode) {
    const duration = Number(progressItem.duration || 0);
    const progress = Number(progressItem.progress || 0);
    if (duration > 0) {
      return { kind: "progress", percent: Math.min(100, Math.max(3, (progress / duration) * 100)), remaining: Math.max(0, duration - progress) };
    }
  }
  return { kind: "none" };
}

export default function EpisodesTab({ mediaId, data }) {
  const navigate = useNavigate();
  const { progressItem, season: currentSeason, episode: currentEpisode } = data;
  const { seasons, selected, setSelected, episodes, loadingSeasons, loadingEpisodes } = useEpisodes(mediaId, true, currentSeason);

  const play = (episodeNumber) => {
    warmPlayback("tv", mediaId, selected, episodeNumber);
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/tv/${mediaId}?s=${selected}&e=${episodeNumber}`);
  };

  return (
    <div data-testid="detail-episodes">
      <div className="fxd-episodes__head">
        <h2 className="fxd-h2" style={{ margin: 0 }}>Episodi</h2>
        {seasons.length ? <SeasonSelect seasons={seasons} value={selected} onChange={setSelected} /> : null}
      </div>

      {!seasons.length ? (
        <div className="fxd-card fxd-empty" data-testid="detail-episodes-empty">
          {loadingSeasons ? "Caricamento stagioni…" : "Nessun episodio disponibile al momento."}
        </div>
      ) : (
        <div className="fxd-episodes" data-testid="detail-episodes-list">
          {episodes.map((episode) => {
            const number = Number(episode.episode_number);
            const state = episodeState(episode, selected, progressItem, currentSeason, currentEpisode);
            const still = episodeStillUrl(episode.still_path) || data.backdropUrl;
            const runtime = Number(episode.runtime || 0);
            const pendingItalian = episode.italian_available === false && episode.italian_audio_status !== "checking";
            return (
              <article
                key={number}
                className="fxd-episode"
                role="button"
                tabIndex={0}
                onClick={() => play(number)}
                onKeyDown={(event) => event.key === "Enter" && play(number)}
                data-testid={`detail-episode-${selected}-${number}`}
              >
                <div className="fxd-episode__thumb">
                  {still ? <img src={still} alt="" loading="lazy" decoding="async" /> : null}
                  <span className="fxd-play-circle"><PlayArrowRoundedIcon /></span>
                </div>
                <div className="fxd-episode__body">
                  <span className="fxd-episode__num">{String(number).padStart(2, "0")}</span>
                  <h3 className="fxd-episode__title">{episode.name || `Episodio ${number}`}</h3>
                  <p className="fxd-episode__desc">{episode.overview || (pendingItalian ? episode.availability_label : "")}</p>
                </div>
                <div className="fxd-episode__status">
                  {state.kind === "done" ? (
                    <>
                      <span className="fxd-episode__done"><CheckCircleRoundedIcon /> Completato</span>
                      <div className="fxd-progress is-done"><div className="fxd-progress__fill" style={{ width: "100%" }} /></div>
                    </>
                  ) : null}
                  {state.kind === "progress" ? (
                    <>
                      <div className="fxd-progress"><div className="fxd-progress__fill" style={{ width: `${state.percent}%` }} /></div>
                      <span className="fxd-episode__remaining"><b>{Math.max(1, Math.ceil(state.remaining / 60))}</b> min rimanenti</span>
                    </>
                  ) : null}
                </div>
                <span className="fxd-episode__runtime">{runtime ? `${runtime} min` : ""}</span>
                <MoreVertRoundedIcon className="fxd-episode__menu" />
              </article>
            );
          })}
          {!episodes.length ? (
            <div className="fxd-card fxd-empty">{loadingEpisodes ? "Caricamento episodi…" : "Nessun episodio riproducibile in questa stagione."}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
