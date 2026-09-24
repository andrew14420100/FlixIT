// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MAIN_PATH } from "src/constant";
import useDetailData from "./detail/useDetailData";
import useSimilarTitles from "./detail/useSimilarTitles";
import DetailHero from "./detail/DetailHero";
import DetailTabs from "./detail/DetailTabs";
import OverviewTab from "./detail/OverviewTab";
import TrailersTab from "./detail/TrailersTab";
import DownloadTab from "./detail/DownloadTab";
import SimilarTab from "./detail/SimilarTab";
import { warmPlayback } from "./detail/detailUtils";
import "./detail/detail.css";

export async function loader() {
  return null;
}

export function Component() {
  const { mediaType, id } = useParams();
  const navigate = useNavigate();
  const mediaId = Number(id) || 0;
  const typeSlug = mediaType === "tv" ? "tv" : "movie";

  const data = useDetailData(typeSlug, mediaId);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    setActiveTab("overview");
    window.scrollTo(0, 0);
  }, [mediaId, typeSlug]);

  const similar = useSimilarTitles(data.type, typeSlug, mediaId, Number(data.detail?.genres?.[0]?.id || 0), !!data.detail);

  const warm = useCallback(() => warmPlayback(typeSlug, mediaId, data.season, data.episode), [typeSlug, mediaId, data.season, data.episode]);
  const goPlay = useCallback(() => {
    warm();
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.watch}/${typeSlug}/${mediaId}${data.isTV ? `?s=${data.season}&e=${data.episode}` : ""}`);
  }, [data.episode, data.isTV, data.season, mediaId, navigate, typeSlug, warm]);

  if (!mediaId) {
    return <div className="fxd-state" data-testid="detail-invalid">Titolo non trovato.</div>;
  }
  if (!data.detail) {
    return (
      <div className="fxd-state" data-testid="detail-loading">
        {data.detailError ? "Impossibile caricare questo titolo." : ""}
      </div>
    );
  }

  return (
    <main className="fxd-page" data-testid="detail-page">
      <DetailHero data={data} mediaId={mediaId} onPlay={goPlay} onWarm={warm} />
      <DetailTabs active={activeTab} onChange={setActiveTab} />
      <div className="fxd-content">
        <div className="fxd-tabpanel" key={activeTab} role="tabpanel" data-testid={`detail-panel-${activeTab}`}>
          {activeTab === "overview" ? <OverviewTab data={data} onPlay={goPlay} /> : null}
          {activeTab === "trailers" ? <TrailersTab data={data} /> : null}
          {activeTab === "download" ? <DownloadTab /> : null}
          {activeTab === "similar" ? <SimilarTab items={similar.items} loading={similar.loading} isTV={data.isTV} /> : null}
        </div>
      </div>
    </main>
  );
}

export default Component;
