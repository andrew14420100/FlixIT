// @ts-nocheck
/**
 * FlixIT Detail Page v2 - router entry point (`/browse/:mediaType/:id`).
 * Pure declarative React; the whole page is styled by pages/detail/detail-page.css (prefix dp-).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MAIN_PATH } from "src/constant";
import useDetailData from "./detail/useDetailData";
import useSimilarTitles from "./detail/useSimilarTitles";
import useEpisodes from "./detail/useEpisodes";
import DetailHero from "./detail/DetailHero";
import DetailTabs from "./detail/DetailTabs";
import DetailOverview from "./detail/DetailOverview";
import DetailEpisodes from "./detail/DetailEpisodes";
import DetailTrailers from "./detail/DetailTrailers";
import DetailDownload from "./detail/DetailDownload";
import DetailSimilar from "./detail/DetailSimilar";
import { detailTabsFor, warmPlayback } from "./detail/detailUtils";
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
  const navigate = useNavigate();
  const mediaId = parseMediaId(id);
  const validType = mediaType === "tv" || mediaType === "movie";
  const typeSlug = mediaType === "tv" ? "tv" : "movie";

  const data = useDetailData(typeSlug, validType ? mediaId : 0);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    setActiveTab("overview");
    window.scrollTo(0, 0);
  }, [mediaId, typeSlug]);

  const similar = useSimilarTitles({
    typeSlug,
    mediaId: validType ? mediaId : 0,
    genreId: data.primaryGenreId,
    enabled: !!data.detail,
  });
  // Seasons list is prefetched once the TV detail is ready; episodes only when the tab is open.
  const episodesState = useEpisodes(validType && data.isTV ? mediaId : 0, !!data.detail, data.season, activeTab === "episodes");
  const tabs = detailTabsFor(data.isTV);

  const warm = useCallback(
    () => warmPlayback(typeSlug, mediaId, data.season, data.episode),
    [typeSlug, mediaId, data.season, data.episode]
  );
  const goPlay = useCallback(() => {
    warm();
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${mediaId}${data.isTV ? `?s=${data.season}&e=${data.episode}` : ""}`);
  }, [data.episode, data.isTV, data.season, mediaId, navigate, typeSlug, warm]);

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
      <div className="dp-page" data-testid="detail-loading" aria-busy="true">
        <div className="dp-hero dp-hero--skeleton" />
      </div>
    );
  }

  return (
    <main className="dp-page" data-testid="detail-page" data-media-type={typeSlug}>
      <DetailHero data={data} mediaId={mediaId} onPlay={goPlay} onWarm={warm} />
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
    </main>
  );
}

export default Component;
