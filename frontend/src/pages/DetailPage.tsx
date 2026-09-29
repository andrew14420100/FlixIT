// @ts-nocheck
/**
 * FlixIT Detail Page v2 - router entry point (`/browse/:mediaType/:id`).
 * Pure declarative React; the whole page is styled by pages/detail/detail-page.css (prefix dp-).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import { MAIN_PATH } from "src/constant";
import useDetailData from "./detail/useDetailData";
import useSimilarTitles from "./detail/useSimilarTitles";
import useEpisodes from "./detail/useEpisodes";
import DetailAmbientExact from "./detail/DetailAmbientExact";
import DetailHero from "./detail/DetailHero";
import DetailTabs from "./detail/DetailTabs";
import DetailOverview from "./detail/DetailOverview";
import DetailEpisodes from "./detail/DetailEpisodes";
import DetailTrailers from "./detail/DetailTrailers";
import DetailDownload from "./detail/DetailDownload";
import DetailSimilar from "./detail/DetailSimilar";
import { API_URL, detailTabsFor, warmPlayback } from "./detail/detailUtils";
import "./detail/detail-page.css";

const AVAILABILITY_CACHE_PREFIX = "flixit:availability:v2-strict-it:";
const AVAILABILITY_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function loader() {
  return null;
}

function parseMediaId(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function availabilityKey(typeSlug, mediaId) {
  return `${AVAILABILITY_CACHE_PREFIX}${typeSlug}:${mediaId}`;
}

function readAvailability(typeSlug, mediaId) {
  if (typeof window === "undefined" || !mediaId) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(availabilityKey(typeSlug, mediaId)) || "null");
    if (!parsed?.state || !parsed?.savedAt) return null;
    if (Date.now() - Number(parsed.savedAt) > AVAILABILITY_CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAvailability(typeSlug, mediaId, state) {
  if (!mediaId || (state !== "available" && state !== "unavailable")) return;
  try {
    localStorage.setItem(
      availabilityKey(typeSlug, mediaId),
      JSON.stringify({ state, savedAt: Date.now() })
    );
  } catch {}
}

export function Component() {
  const { mediaType, id } = useParams();
  const navigate = useNavigate();
  const mediaId = parseMediaId(id);
  const validType = mediaType === "tv" || mediaType === "movie";
  const typeSlug = mediaType === "tv" ? "tv" : "movie";

  const data = useDetailData(typeSlug, validType ? mediaId : 0);
  const [activeTab, setActiveTab] = useState("overview");
  const [italianAvailability, setItalianAvailability] = useState(() => {
    if (!validType || !mediaId) return "unavailable";
    return readAvailability(typeSlug, mediaId)?.state || "available";
  });

  useEffect(() => {
    setActiveTab("overview");
    window.scrollTo(0, 0);
  }, [mediaId, typeSlug]);

  useEffect(() => {
    if (!validType || !mediaId) {
      setItalianAvailability("unavailable");
      return undefined;
    }

    let alive = true;
    let running = false;
    const cached = readAvailability(typeSlug, mediaId);
    setItalianAvailability(cached?.state || "available");

    const check = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`${API_URL}/api/public/availability/${typeSlug}/${mediaId}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const payload = response.ok ? await response.json() : null;
        if (!alive || !payload?.catalog_loaded) return;
        const next = payload.available === true ? "available" : "unavailable";
        writeAvailability(typeSlug, mediaId, next);
        setItalianAvailability(next);
      } catch {
        // Availability is synchronization data, never a reason to replace an
        // already-rendered Detail page with a loading state on transient errors.
      } finally {
        running = false;
      }
    };

    const firstCheck = window.setTimeout(check, cached ? 1200 : 0);
    const timer = window.setInterval(check, 90 * 1000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearTimeout(firstCheck);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [mediaId, typeSlug, validType]);

  const similar = useSimilarTitles({
    typeSlug,
    mediaId: validType ? mediaId : 0,
    genreId: data.primaryGenreId,
    enabled: !!data.detail && italianAvailability === "available",
  });

  const episodesState = useEpisodes(
    validType && data.isTV ? mediaId : 0,
    validType && data.isTV && italianAvailability !== "unavailable",
    data.season,
    activeTab === "episodes",
    data.episode
  );
  const tabs = detailTabsFor(data.isTV);

  // Continue Watching can contain an old cursor that points at an episode which
  // later turns out to be original/English only. Never let that stale cursor
  // bypass the verified Italian episode list and open the player directly.
  const playbackTarget = useMemo(() => {
    if (!data.isTV) {
      return {
        ready: true,
        season: Number(data.season || 1),
        episode: Number(data.episode || 1),
        resumeValid: !!data.hasRealProgress,
      };
    }

    const selectedSeason = Math.max(1, Number(episodesState.selected || data.season || 1));
    const verified = Array.isArray(episodesState.episodes) ? episodesState.episodes : [];
    const requestedSeason = Math.max(1, Number(data.season || 1));
    const requestedEpisode = Math.max(1, Number(data.episode || 1));
    const requestedIsVerified = selectedSeason === requestedSeason && verified.some(
      (item) => Number(item?.episode_number || 0) === requestedEpisode
    );
    const fallbackEpisode = Number(verified[0]?.episode_number || 0);

    return {
      ready: verified.length > 0 && fallbackEpisode > 0,
      season: selectedSeason,
      episode: requestedIsVerified ? requestedEpisode : fallbackEpisode,
      resumeValid: !!data.hasRealProgress && requestedIsVerified,
    };
  }, [
    data.isTV,
    data.season,
    data.episode,
    data.hasRealProgress,
    episodesState.selected,
    episodesState.episodes,
  ]);

  const safeData = useMemo(() => {
    if (!data.isTV) return data;
    return {
      ...data,
      season: playbackTarget.season,
      episode: playbackTarget.episode || 1,
      hasRealProgress: playbackTarget.resumeValid,
    };
  }, [data, playbackTarget]);

  const warm = useCallback(() => {
    if (data.isTV && !playbackTarget.ready) return Promise.resolve(null);
    return warmPlayback(typeSlug, mediaId, playbackTarget.season, playbackTarget.episode);
  }, [data.isTV, typeSlug, mediaId, playbackTarget]);

  // Resolve the exact verified target while the user reads the Detail page, not
  // after Play is clicked. The global player coalescer lets Watch reuse it.
  useEffect(() => {
    if (!validType || !mediaId || !data.detail || italianAvailability !== "available") return;
    if (data.isTV && !playbackTarget.ready) return;
    const timer = window.setTimeout(() => { void warm(); }, 80);
    return () => window.clearTimeout(timer);
  }, [validType, mediaId, data.detail, data.isTV, italianAvailability, playbackTarget.ready, warm]);

  const goPlay = useCallback(() => {
    if (italianAvailability !== "available") return;
    if (data.isTV && !playbackTarget.ready) return;
    void warm();
    window.scrollTo(0, 0);
    navigate(
      `/${MAIN_PATH.watch}/${typeSlug}/${mediaId}${
        data.isTV ? `?s=${playbackTarget.season}&e=${playbackTarget.episode}` : ""
      }`
    );
  }, [
    data.isTV,
    italianAvailability,
    mediaId,
    navigate,
    playbackTarget,
    typeSlug,
    warm,
  ]);

  const showMoreInfo = useCallback(() => {
    setActiveTab("overview");
    window.setTimeout(() => {
      document.querySelector(".dp-tabs-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  if (!mediaId || !validType) {
    return (
      <div className="dp-state" data-testid="detail-invalid">
        <div>
          <p>Titolo non trovato.</p>
          <Link to="/">Torna alla Home</Link>
        </div>
      </div>
    );
  }

  if (italianAvailability === "unavailable") {
    return (
      <div className="dp-state" data-testid="detail-not-italian">
        <div>
          <p>Questo titolo non è ancora disponibile con doppiaggio italiano.</p>
          <Link to="/">Torna alla Home</Link>
        </div>
      </div>
    );
  }

  if (!data.detail) {
    if (data.detailError) {
      return (
        <div className="dp-state" data-testid="detail-error">
          <div>
            <p>Impossibile caricare questo titolo.</p>
            <Link to="/">Torna alla Home</Link>
          </div>
        </div>
      );
    }
    return (
      <Box className="dp-page" data-testid="detail-loading" aria-busy="true" sx={{ pt: { xs: 0, md: "80px" } }}>
        <div className="dp-hero dp-hero--skeleton" />
      </Box>
    );
  }

  return (
    <Box component="main" className="dp-page" data-testid="detail-page" data-media-type={typeSlug} sx={{ pt: { xs: 0, md: "80px" } }}>
      <DetailAmbientExact />
      <DetailHero data={safeData} mediaId={mediaId} onPlay={goPlay} onWarm={warm} onMoreInfo={showMoreInfo} />
      <DetailTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      <div className="dp-content">
        <section className="dp-panel" role="tabpanel" id="dp-panel-overview" aria-labelledby="dp-tab-overview" data-testid="detail-panel-overview" hidden={activeTab !== "overview"}>
          <DetailOverview data={safeData} onPlay={goPlay} onWarm={warm} />
        </section>

        {data.isTV ? (
          <section className="dp-panel" role="tabpanel" id="dp-panel-episodes" aria-labelledby="dp-tab-episodes" data-testid="detail-panel-episodes" hidden={activeTab !== "episodes"}>
            <DetailEpisodes mediaId={mediaId} data={safeData} episodesState={episodesState} />
          </section>
        ) : null}

        {activeTab === "trailers" ? (
          <section className="dp-panel" role="tabpanel" id="dp-panel-trailers" aria-labelledby="dp-tab-trailers" data-testid="detail-panel-trailers">
            <DetailTrailers data={safeData} />
          </section>
        ) : null}

        {activeTab === "download" ? (
          <section className="dp-panel" role="tabpanel" id="dp-panel-download" aria-labelledby="dp-tab-download" data-testid="detail-panel-download">
            <DetailDownload />
          </section>
        ) : null}

        {activeTab === "similar" ? (
          <section className="dp-panel" role="tabpanel" id="dp-panel-similar" aria-labelledby="dp-tab-similar" data-testid="detail-panel-similar">
            <DetailSimilar items={similar.items} loading={similar.loading} isTV={data.isTV} />
          </section>
        ) : null}
      </div>
    </Box>
  );
}

export default Component;
