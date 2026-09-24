// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import TheaterComedyOutlinedIcon from "@mui/icons-material/TheaterComedyOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import { remainingText, runtimeText } from "./detailUtils";

function Plot({ text }) {
  const ref = useRef(null);
  const [clamped, setClamped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  // Measure only (no DOM writes): shows "… altro" when the 3-line clamp cuts the plot.
  useEffect(() => {
    const element = ref.current;
    if (!element || expanded) return undefined;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className={`dp-plot-wrap${expanded ? " is-expanded" : ""}`}>
      <p ref={ref} className="dp-plot" data-testid="detail-plot">{text || "Nessuna trama disponibile."}</p>
      {clamped && !expanded ? (
        <button type="button" className="dp-plot__more" onClick={() => setExpanded(true)} data-testid="detail-plot-more">
          … altro
        </button>
      ) : null}
    </div>
  );
}

function InfoBox({ icon, label, value, testId }) {
  return (
    <div className="dp-info" data-testid={testId}>
      <div className="dp-info__icon">{icon}</div>
      <div className="dp-info__text">
        <span className="dp-info__label">{label}</span>
        <span className="dp-info__value">{value}</span>
      </div>
    </div>
  );
}

export default function DetailOverview({ data, onPlay, onWarm }) {
  const {
    isTV, title, overview, genres, year, certification, seasonsCount, runtimeMinutes, backdropUrl,
    hasRealProgress, progressPercent, remainingSeconds, season, episode, episodeTitle,
  } = data;

  const resumeTitle = isTV ? `S${season}:E${episode}${episodeTitle ? ` - ${episodeTitle}` : ""}` : title;
  const resumeTime = `${remainingText(remainingSeconds)} rimanenti`;

  const onThumbKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPlay();
    }
  };

  return (
    <div
      className="dp-overview"
      style={hasRealProgress ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}
      data-testid="detail-overview"
      data-has-real-progress={hasRealProgress ? "true" : "false"}
    >
      <article className="dp-card dp-overview__main" data-testid="detail-overview-panel">
        <h2 className="dp-h2">Panoramica</h2>
        <div className="dp-divider" />
        <Plot text={overview} />
        <div className="dp-divider" />
        <div className="dp-info-grid">
          <InfoBox testId="detail-info-genre" icon={<TheaterComedyOutlinedIcon />} label="Genere" value={genres[0] || "—"} />
          <InfoBox testId="detail-info-year" icon={<CalendarMonthOutlinedIcon />} label="Anno" value={year || "—"} />
          {isTV ? (
            <InfoBox testId="detail-info-seasons" icon={<LayersOutlinedIcon />} label="Stagioni" value={seasonsCount || "—"} />
          ) : (
            <InfoBox testId="detail-info-runtime" icon={<ScheduleOutlinedIcon />} label="Durata" value={runtimeText(runtimeMinutes) || "—"} />
          )}
          <InfoBox
            testId="detail-info-rating"
            icon={<span className="dp-info__cert">{certification || "—"}</span>}
            label="Classificazione"
            value={certification || "—"}
          />
        </div>
      </article>

      {hasRealProgress ? (
        <article className="dp-card dp-resume" data-testid="detail-resume-panel">
          <h2 className="dp-h2">Continua a guardare</h2>
          <div
            className="dp-resume__thumb"
            role="button"
            tabIndex={0}
            aria-label="Continua a guardare"
            onClick={onPlay}
            onMouseEnter={onWarm}
            onKeyDown={onThumbKey}
            data-testid="detail-resume-thumb"
          >
            {backdropUrl ? <img src={backdropUrl} alt="" loading="lazy" decoding="async" /> : null}
            <span className="dp-play-circle" aria-hidden="true"><PlayArrowRoundedIcon /></span>
          </div>
          <div className="dp-resume__row">
            <span className="dp-resume__title" data-testid="detail-resume-title">{resumeTitle}</span>
            <span className="dp-resume__time" data-testid="detail-resume-time">{resumeTime}</span>
          </div>
          <div className="dp-progress" data-testid="detail-resume-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}>
            <div className="dp-progress__fill" style={{ width: `${Math.max(2, progressPercent)}%` }} />
          </div>
          <div className="dp-resume__grow" />
        </article>
      ) : null}
    </div>
  );
}
