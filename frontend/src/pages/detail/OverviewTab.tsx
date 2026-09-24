// @ts-nocheck
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import TheaterComedyOutlinedIcon from "@mui/icons-material/TheaterComedyOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import { runtimeText, secondsText } from "./detailUtils";

const PLOT_LIMIT = 260;

function InfoBox({ icon, label, value, testId }) {
  return (
    <div className="fxd-info" data-testid={testId}>
      <div className="fxd-info__icon">{icon}</div>
      <div style={{ minWidth: 0 }}>
        <span className="fxd-info__label">{label}</span>
        <span className="fxd-info__value">{value}</span>
      </div>
    </div>
  );
}

export default function OverviewTab({ data, onPlay }) {
  const { isTV, title, overview, genres, year, certification, seasonsCount, runtimeMinutes, backdropUrl } = data;
  const { progressItem, progressPercent, remainingSeconds, season, episode, episodeTitle, episodeRuntime } = data;

  const truncated = overview.length > PLOT_LIMIT;
  const plot = truncated ? overview.slice(0, PLOT_LIMIT).replace(/\s+\S*$/, "").trim() : overview;

  const resumeTitle = isTV
    ? `S${season}:E${episode}${episodeTitle ? ` - ${episodeTitle}` : ""}`
    : title;
  const resumeTime = progressItem
    ? `${secondsText(remainingSeconds)} rimanenti`
    : isTV && episodeRuntime ? `${episodeRuntime} min` : !isTV && runtimeMinutes ? runtimeText(runtimeMinutes) : "Inizia";

  return (
    <div className="fxd-overview" data-testid="detail-overview">
      <article className="fxd-card fxd-overview__panel" data-testid="detail-overview-panel">
        <h2 className="fxd-h2">Panoramica</h2>
        <div className="fxd-divider" />
        <p className="fxd-plot" data-testid="detail-plot">
          {plot || "Nessuna trama disponibile."}
          {truncated ? <span className="fxd-plot__more">… altro</span> : null}
        </p>
        <div className="fxd-divider" />
        <div className="fxd-info-grid">
          <InfoBox testId="detail-info-genre" icon={<TheaterComedyOutlinedIcon />} label="Genere" value={genres[0] || "—"} />
          <InfoBox testId="detail-info-year" icon={<CalendarMonthOutlinedIcon />} label="Anno" value={year || "—"} />
          {isTV ? (
            <InfoBox testId="detail-info-seasons" icon={<LayersOutlinedIcon />} label="Stagioni" value={seasonsCount || "—"} />
          ) : (
            <InfoBox testId="detail-info-runtime" icon={<ScheduleOutlinedIcon />} label="Durata" value={runtimeText(runtimeMinutes) || "—"} />
          )}
          <InfoBox
            testId="detail-info-rating"
            icon={<span className="fxd-info__cert">{certification || "—"}</span>}
            label="Classificazione"
            value={certification || "—"}
          />
        </div>
      </article>

      <article className="fxd-card fxd-overview__panel fxd-resume" data-testid="detail-resume-panel">
        <h2 className="fxd-h2">Continua a guardare</h2>
        <div className="fxd-resume__thumb" onClick={onPlay} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onPlay()} data-testid="detail-resume-thumb">
          {backdropUrl ? <img src={backdropUrl} alt="" loading="lazy" decoding="async" /> : null}
          <span className="fxd-play-circle"><PlayArrowRoundedIcon /></span>
        </div>
        <div className="fxd-resume__row">
          <span className="fxd-resume__title" data-testid="detail-resume-title">{resumeTitle}</span>
          <span className="fxd-resume__time" data-testid="detail-resume-time">{resumeTime}</span>
        </div>
        <div className="fxd-progress" data-testid="detail-resume-progress">
          <div className="fxd-progress__fill" style={{ width: `${progressItem ? Math.max(3, progressPercent) : 0}%` }} />
        </div>
        <div className="fxd-resume__spacer" />
      </article>
    </div>
  );
}
