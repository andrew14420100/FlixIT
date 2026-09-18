// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";

export const TMDB_IMG = "https://image.tmdb.org/t/p/";

const GENRE_NAMES: Record<number, string> = {
  12: "Avventura",
  14: "Fantasy",
  16: "Animazione",
  18: "Dramma",
  27: "Horror",
  28: "Azione",
  35: "Commedia",
  36: "Storia",
  37: "Western",
  53: "Thriller",
  80: "Crime",
  99: "Documentario",
  878: "Sci-Fi",
  9648: "Mistero",
  10402: "Musica",
  10749: "Romance",
  10751: "Famiglia",
  10752: "Guerra",
  10759: "Azione & Avventura",
  10762: "Kids",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
};

function imageUrl(value: any, size = "w780") {
  if (!value) return "";
  if (
    typeof value === "string" &&
    (/^https?:\/\//i.test(value) || value.startsWith("data:"))
  ) {
    return value;
  }

  const path = String(value);
  return `${TMDB_IMG}${size}${path.startsWith("/") ? path : `/${path}`}`;
}

function getPreviewCover(item: any) {
  return imageUrl(
    item?.titled_backdrop_path ||
      item?.cover_path ||
      item?.cover ||
      item?.backdrop_path ||
      item?.backdrop ||
      item?.poster_path ||
      item?.poster,
    "w780"
  );
}

function getLogo(item: any) {
  return imageUrl(
    item?.logo_path ||
      item?.logo ||
      item?.assets?.logo_path ||
      item?.assets?.logo ||
      item?.images?.logos?.[0]?.file_path,
    "w500"
  );
}

function getGenres(item: any) {
  const values = item?.genres?.length
    ? item.genres
        .map((g: any) => (typeof g === "string" ? g : g?.name))
        .filter(Boolean)
    : (item?.genre_ids || [])
        .map((id: number) => GENRE_NAMES[id])
        .filter(Boolean);

  return values.slice(0, 3);
}

function getType(item: any, mediaType: any) {
  if (item?.type === "tv" || item?.media_type === "tv") return "tv";
  if (item?.type === "movie" || item?.media_type === "movie") return "movie";
  return String(mediaType).toLowerCase().includes("tv") ? "tv" : "movie";
}

function getUpcomingDate(item: any) {
  const raw =
    item?.last_air_date ||
    item?.release_date ||
    item?.first_air_date ||
    "";

  if (!raw) return null;

  const parts = String(raw).split("-");
  if (parts.length !== 3) return null;

  const date = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );

  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return null;
  }

  return date.toLocaleDateString("it-IT", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function TitleButton({
  children,
  className = "",
  onClick,
  pushRight = false,
}: any) {
  return (
    <div
      className={`title-btn ${className}`.trim()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
      }}
      style={{
        color: "#fff",
        textDecoration: "none",
        width: "3em",
        height: "3em",
        border: "2px solid #8c8c8c",
        backgroundColor: "#212121",
        borderRadius: "50%",
        textAlign: "center",
        marginRight: pushRight ? 0 : ".8em",
        marginLeft: pushRight ? "auto" : 0,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        fontSize: ".85em",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = "#fff";
        event.currentTarget.style.backgroundColor = "#363636";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = "#8c8c8c";
        event.currentTarget.style.backgroundColor = "#212121";
      }}
    >
      {children}
    </div>
  );
}

export default function ExpandedCard({
  item,
  mediaType,
  onPlay,
  onDetail,
  display = true,
  watch,
}: any) {
  const cover = getPreviewCover(item);
  const logo = getLogo(item);
  const genres = useMemo(() => getGenres(item), [item]);
  const type = getType(item, mediaType);

  const userWatch = watch || item?.user_watchlist || item?.watch || null;

  const releaseDate =
    item?.release_date ||
    item?.first_air_date ||
    "";

  const score =
    item?.score ??
    item?.vote_average ??
    item?.rating ??
    item?.voteAverage ??
    "";

  const runtime =
    item?.runtime ||
    item?.duration ||
    item?.details?.runtime ||
    "";

  const seasons =
    item?.seasons_count ||
    item?.number_of_seasons ||
    item?.seasonsCount ||
    "";

  const age =
    item?.age ||
    item?.content_rating ||
    item?.certification ||
    "";

  const isUpcoming =
    !!item?.upcoming ||
    !!item?.isUpcoming;

  const upcomingDate = getUpcomingDate(item);

  const preview =
    item?.preview ||
    {};

  const previewUrl =
    preview?.embed_url ||
    preview?.embedUrl ||
    item?.preview_embed_url ||
    "";

  const canShowPreview =
    !!previewUrl &&
    !!preview?.is_viewable;

  const [previewPlaying, setPreviewPlaying] = useState(false);

  useEffect(() => {
    setPreviewPlaying(false);
  }, [previewUrl]);

  const progress =
    userWatch?.progressPercent ??
    userWatch?.percentage ??
    userWatch?.percent ??
    (userWatch?.duration > 0
      ? (
          Number(userWatch?.progress || userWatch?.currentTime || 0) /
          Number(userWatch.duration)
        ) * 100
      : 0);

  const episode = userWatch?.episode;

  return (
    <>
      <div
        className="player"
        style={{
          borderRadius: ".4em .4em 0 0",
          backgroundColor: "#000",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <div
          className="preview-box-16x9"
          style={{
            height: "100%",
            paddingTop: "56.3925%",
            width: "100%",
          }}
        >
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault();
              onDetail?.(event);
            }}
          >
            {cover && (
              <img
                src={cover}
                className="preview-image"
                alt={item?.title || item?.name || ""}
                draggable={false}
                style={{
                  borderRadius: ".4em .4em 0 0",
                  height: "100%",
                  left: 0,
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  right: 0,
                  width: "100%",
                }}
              />
            )}
          </a>

          {item?.sub_ita && (
            <div
              className="sub-ita"
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                borderBottom: "1.5em solid white",
                color: "#000",
                fontSize: ".7em",
                borderRadius: "0 0 3px",
                fontWeight: 700,
                padding: "0 .4em 0 .2em",
                borderLeft: ".75em solid transparent",
                height: 0,
              }}
            >
              SUB
            </div>
          )}
        </div>

        <div
          className="trailer-container"
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          }}
        >
          {canShowPreview && (
            <div
              className="trailer-preview"
              style={{
                position: "absolute",
                overflow: "hidden",
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                width: "100%",
                height: "100%",
                background: "#070707",
                transition: "opacity .5s",
                opacity: 1,
              }}
            >
              <iframe
                frameBorder="0"
                height="100%"
                width="100%"
                src={previewUrl}
                allow="autoplay; fullscreen"
                title="Anteprima"
                onLoad={() => {
                  setTimeout(() => setPreviewPlaying(true), 25);
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: 0,
                }}
              />

              <div
                className="label"
                style={{
                  display: "none",
                }}
              >
                <span>Anteprima</span>
              </div>

              <div
                className="mute-button"
                style={{
                  position: "absolute",
                  right: "1.2em",
                  bottom: "1.2em",
                  zIndex: 2,
                  color: "#fff",
                  textDecoration: "none",
                  width: "3em",
                  height: "3em",
                  border: "2px solid #8c8c8c",
                  backgroundColor: "#212121",
                  borderRadius: "50%",
                  textAlign: "center",
                  cursor: "pointer",
                  opacity: 0.4,
                  transition: "opacity .2s linear",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: ".9em",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = "#fff";
                  event.currentTarget.style.backgroundColor = "#363636";
                  event.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = "#8c8c8c";
                  event.currentTarget.style.backgroundColor = "#212121";
                  event.currentTarget.style.opacity = ".4";
                }}
              >
                <svg
                  viewBox="0 0 576 512"
                  width="1.36em"
                  height="1.2em"
                  style={{ color: "#fff", lineHeight: "2.4em" }}
                >
                  <path
                    fill="currentColor"
                    d="M301.1 34.8C312.6 40 320 51.4 320 64v384c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64v-64c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3M425 167l55 55l55-55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-55 55l55 55c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-55-55l-55 55c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l55-55l-55-55c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0"
                  />
                </svg>
              </div>
            </div>
          )}

          <div
            className="trailer-click"
            onClick={onDetail}
            style={{
              display: "flex",
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
            }}
          />
        </div>

        {logo && previewPlaying && (
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault();
              onDetail?.(event);
            }}
          >
            <img
              className="logo"
              src={logo}
              alt={item?.title || item?.name || ""}
              style={{
                position: "absolute",
                bottom: "1em",
                left: "1em",
                maxHeight: "20%",
                maxWidth: "40%",
              }}
            />
          </a>
        )}
      </div>

      <div
        className="info"
        style={{
          opacity: display ? 1 : 0,
          backgroundColor: "#151515",
          position: "relative",
          transition: "opacity .2s",
          borderRadius: "0 0 .4em .4em",
        }}
      >
        <div
          className="info-container"
          style={{
            padding: "1.35em 1.2em",
            height: "10em",
          }}
        >
          <div
            className="buttons"
            style={{
              alignItems: "center",
              display: "flex",
              minHeight: "2em",
            }}
          >
            <a
              href="#"
              className="play"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onPlay?.(event);
              }}
              style={{
                fontSize: ".85em",
                width: "3em",
                height: "3em",
                borderRadius: "50%",
                backgroundColor: "#fff",
                textAlign: "center",
                marginRight: ".8em",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                viewBox="0 0 384 512"
                width=".9em"
                height="1.2em"
                style={{
                  fontSize: "1.4em",
                  paddingLeft: ".1em",
                  color: "#000",
                }}
              >
                <path
                  fill="currentColor"
                  d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80v352c0 17.4 9.4 33.4 24.5 41.9S58.2 482 73 473l288-176c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41z"
                />
              </svg>
            </a>

            <TitleButton>
              <svg
                viewBox="0 0 448 512"
                width="1.06em"
                height="1.2em"
                className="plus-icon"
                style={{ fontSize: "1.35em" }}
              >
                <path
                  fill="currentColor"
                  d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32v144H48c-17.7 0-32 14.3-32 32s14.3 32 32 32h144v144c0 17.7 14.3 32 32 32s32-14.3 32-32V288h144c17.7 0 32-14.3 32-32s-14.3-32-32-32H256z"
                />
              </svg>
            </TitleButton>

            <TitleButton>
              <svg
                viewBox="0 0 576 512"
                width="1.36em"
                height="1.2em"
                className="star-icon"
              >
                <path
                  fill="currentColor"
                  d="M316.9 18c-5.3-11-16.5-18-28.8-18s-23.4 7-28.8 18L195 150.3L51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329l-24.6 145.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5l128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329l104.2-103.1c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7l-143.7-21.2z"
                />
              </svg>
            </TitleButton>

            <TitleButton
              className="more-info"
              pushRight
              onClick={onDetail}
            >
              <svg
                viewBox="0 0 448 512"
                width="1.06em"
                height="1.2em"
                style={{
                  color: "#fff",
                  fontSize: "1.3em",
                }}
              >
                <path
                  fill="currentColor"
                  d="M201.4 374.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 306.7L86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z"
                />
              </svg>
            </TitleButton>
          </div>

          {userWatch ? (
            <>
              <div
                className="watchlist-title"
                style={{
                  margin: ".735em 0 .5em",
                  fontSize: "1.1em",
                  display: "-webkit-box",
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {type === "tv" && (
                  <b>
                    S{episode?.season?.number ?? userWatch?.season ?? 1}:E
                    {episode?.number ?? userWatch?.episode ?? 1}
                  </b>
                )}
                {" "}
                "
                {type === "tv"
                  ? episode?.name || item?.name || item?.title || ""
                  : item?.name || item?.title || ""}
                "
              </div>

              <div
                className="progress"
                style={{
                  padding: "0 1.2em",
                  justifyContent: "left",
                  display: "flex",
                }}
              >
                <span
                  className="progress-bar"
                  style={{
                    flexGrow: 1,
                    backgroundColor: "#ffffff4d",
                    display: "block",
                    height: "3px",
                    position: "relative",
                  }}
                >
                  <span
                    role="presentation"
                    className="progress-completed"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, Number(progress) || 0)
                      )}%`,
                      backgroundColor: "#018850",
                      height: "3px",
                      left: 0,
                      position: "absolute",
                      top: 0,
                    }}
                  />
                </span>
              </div>
            </>
          ) : (
            <>
              <div
                className="metadata"
                style={{
                  margin: ".735em 0 .5em",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {isUpcoming ? (
                  <span
                    className="upcoming"
                    style={{
                      fontWeight: 700,
                      color: "#fff",
                      fontSize: "1.1em",
                    }}
                  >
                    {upcomingDate
                      ? `In arrivo il ${upcomingDate}`
                      : "In arrivo prossimamente"}
                  </span>
                ) : (
                  <>
                    <span
                      className="rating"
                      style={{
                        color: "#1cc88c",
                        fontWeight: 700,
                        fontSize: "1.1em",
                      }}
                    >
                      Score {score}
                    </span>

                    <span
                      className="separator"
                      style={{
                        lineHeight: "1.2em",
                        margin: "0 .2em",
                        color: "gray",
                      }}
                    >
                      -
                    </span>

                    <span
                      className="metadata-item"
                      style={{ lineHeight: "1.2em" }}
                    >
                      {releaseDate?.substring?.(0, 4) || ""}
                    </span>

                    <span
                      className="separator"
                      style={{
                        lineHeight: "1.2em",
                        margin: "0 .2em",
                        color: "gray",
                      }}
                    >
                      -
                    </span>

                    {type === "movie" ? (
                      <span
                        className="metadata-item"
                        style={{ lineHeight: "1.2em" }}
                      >
                        {runtime} min
                      </span>
                    ) : (
                      <span
                        className="metadata-item"
                        style={{ lineHeight: "1.2em" }}
                      >
                        {seasons}
                        {Number(seasons) !== 1
                          ? " stagioni"
                          : " stagione"}
                      </span>
                    )}

                    {age ? (
                      <span
                        className="badge"
                        style={{
                          fontSize: ".7em",
                          padding: "0 .25em",
                          borderRadius: ".25em",
                          border: "1px solid #8c8c8c",
                          color: "#e0e0e0",
                          marginLeft: ".9em",
                        }}
                      >
                        {String(age).replace("+", "")}+
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              <div
                className="genres"
                style={{
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                {genres.map((genre: string, index: number) => (
                  <span
                    className="genre"
                    key={`${genre}-${index}`}
                    style={{ fontSize: "1em" }}
                  >
                    {genre}{" "}
                    {index + 1 < 3 &&
                    genres.length > index + 1 ? (
                      <span
                        className="separator"
                        style={{ color: "gray" }}
                      >
                        •{" "}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
