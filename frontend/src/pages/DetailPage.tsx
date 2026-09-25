// @ts-nocheck
/**
 * FlixIT Detail Page v2 - router entry point (`/browse/:mediaType/:id`).
 * Pure declarative React; the whole page is styled by pages/detail/detail-page.css (prefix dp-).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
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
import ProviderPlaybackFeedback from "src/components/ProviderPlaybackFeedback";
import useProviderPlayback from "src/hooks/useProviderPlayback";
import { API_URL, detailTabsFor } from "./detail/detailUtils";
import "./detail/detail-page.css";

export async function loader() {
  return null;
}

function parseMediaId(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function Component() {
  const { mediaType, id } = useParams();
  const mediaId = parseMediaId(id);
  const validType = mediaType === "tv" || mediaType === "movie";
  const typeSlug = mediaType === "tv" ? "tv" : "movie";

  const data = useDetailData(typeSlug, validType ? mediaId : 0);
  const [activeTab, setActiveTab] = useState("overview");
  const [italianAvailability, setItalianAvailability] = useState("checking");
  const {
    isLoading: playbackLoading,
    error: playbackError,
    clearError: clearPlaybackError,
    startPlayback,
  } = useProviderPlayback();

  useEffect(() => {
    setActiveTab("overview");
    window.scrollTo(0, 0);
  }, [mediaId, typeSlug]);

  // Direct URLs obey the same strict Italian policy as Home/catalogue rows.
  // Recheck periodically and on focus so a newly dubbed title becomes visible
  // automatically once the backend Italian catalogue contains it.
  useEffect(() => {
    if (!validType || !mediaId) {
      setItalianAvailability("unavailable");
      return undefined;
    }

    let alive = true;
    let running = false;
    setItalianAvailability("checking");

    const check = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`${API_URL}/api/public/availability/${typeSlug}/${mediaId}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const payload = response.ok ? await response.json() : null;
        if (!alive) return;
        if (!payload?.catalog_loaded) {
          setItalianAvailability("checking");
        } else {
          setItalianAvailability(payload.available === true ? "available" : "unavailable");
        }
      } catch {
        if (alive) setItalianAvailability("checking");
      } finally {
        running = false;
      }
    };

    check();
    const timer = window.setInterval(check, 90 * 1000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
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

  // Start warming seasons + current-season episodes as soon as TV detail data
  // exists, even while the availability check / Panoramica is still on screen.
  // This makes the Episodi tab open from cache instead of starting a request on click.
  const episodesState = useEpisodes(
    validType && data.isTV ? mediaId : 0,
    !!data.detail && italianAvailability !== "unavailable",
    data.season,
    activeTab === "episodes"
  );
  const tabs = detailTabsFor(data.isTV);

  // Provider resolution is intentionally click-driven. Real-Debrid/provider work
  // must not start just because a user hovers the play control.
  const warm = useCallback(() => undefined, []);

  const goPlay = useCallback(async () => {
    if (italianAvailability !== "available" || playbackLoading) return;

    window.scrollTo(0, 0);
    await startPlayback({
      contentTitle:
        data.title ||
        data.detail?.title ||
        data.detail?.name ||
        String(mediaId),
      mediaType: typeSlug,
      mediaId,
      season: data.season,
      episode: data.episode,
      startTime: Number(data.progressItem?.progress || 0),
    });
  }, [
    data.detail?.name,
    data.detail?.title,
    data.episode,
    data.progressItem?.progress,
    data.season,
    data.title,
    italianAvailability,
    mediaId,
    playbackLoading,
    startPlayback,
    typeSlug,
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

  if (italianAvailability === "checking" || !data.detail) {
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
    <Box
      component="main"
      className="dp-page"
      data-testid="detail-page"
      data-media-type={typeSlug}
      sx={{ pt: { xs: 0, md: "80px" } }}
    >
      <DetailAmbientExact />
      <DetailHero data={data} mediaId={mediaId} onPlay={goPlay} onWarm={warm} onMoreInfo={showMoreInfo} />
      <DetailTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      <div className="dp-content">
        <section
          key={activeTab}
          className="dp-panel"
          role="tabpanel"
          id={`dp-panel-${activeTab}`}
          aria-labelledby={`dp-tab-${activeTab}`}
          data-testid={`detail-panel-${activeTab}`}
        >
          {activeTab === "overview" ? <DetailOverview data={data} onPlay={goPlay} onWarm={warm} /> : null}
          {activeTab === "episodes" && data.isTV ? <DetailEpisodes mediaId={mediaId} data={data} episodesState={episodesState} /> : null}
          {activeTab === "trailers" ? <DetailTrailers data={data} /> : null}
          {activeTab === "download" ? <DetailDownload /> : null}
          {activeTab === "similar" ? <DetailSimilar items={similar.items} loading={similar.loading} isTV={data.isTV} /> : null}
        </section>
      </div>

      <ProviderPlaybackFeedback
        loading={playbackLoading}
        error={playbackError}
        title={data.title}
        onCloseError={clearPlaybackError}
      />
    </Box>
  );
}

export default Component;
