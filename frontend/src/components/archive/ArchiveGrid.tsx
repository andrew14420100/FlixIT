// @ts-nocheck
import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import VideoItemWithHover from "src/components/VideoItemWithHover";
import { MEDIA_TYPE } from "src/types/Common";

const fmt = (n) => new Intl.NumberFormat("it-IT").format(n || 0);

function ResultsHeader({ total, loaded, sort, sorts, onSort, isFetching }) {
  return (
    <Box data-testid="archive-results-header" sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.5, mt: 3, mb: 3 }}>
      <Typography data-testid="archive-results-count" sx={{ color: "rgba(255,255,255,0.85)", fontSize: 15 }}>
        <Box component="strong" sx={{ color: "#fff", fontWeight: 700 }}>{total > loaded ? `≈ ${fmt(total)}` : fmt(loaded)}</Box> titoli
      </Typography>
      <Box sx={{ width: "1px", height: 16, bgcolor: "rgba(255,255,255,0.18)" }} />
      <Typography component="label" htmlFor="archive-sort" sx={{ color: "rgba(255,255,255,0.6)", fontSize: 15 }}>ordina per:</Typography>
      <Box component="select" id="archive-sort" value={sort} onChange={(e) => onSort(e.target.value)} data-testid="archive-sort-select"
        sx={{ bgcolor: "transparent", color: "#fff", border: "none", fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, cursor: "pointer", outline: "none", pr: 0.5,
          "& option": { bgcolor: "#141414", color: "#fff", fontWeight: 500 } }}>
        {sorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </Box>
      {isFetching && <CircularProgress size={16} sx={{ color: "#E50914", ml: 1 }} />}
    </Box>
  );
}

export default function ArchiveGrid({ pages, total, sort, sorts, onSort, isFetching, isPending, hasMore, onMore }) {
  const items = (pages || []).flatMap((p) => p.items || []);
  const sentinel = useRef(null);
  // Stop auto-loading after two consecutive pages without Italian-dubbed results; offer a manual button instead.
  const trailingEmpty = (() => { let n = 0; for (let i = (pages || []).length - 1; i >= 0 && !(pages[i].items || []).length; i--) n++; return n; })();
  const autoLoad = hasMore && trailingEmpty < 2;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !autoLoad || isFetching) return;
    const obs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), { rootMargin: "700px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [autoLoad, isFetching, onMore, items.length]);

  return (
    <Box>
      <ResultsHeader total={total} loaded={items.length} sort={sort} sorts={sorts} onSort={onSort} isFetching={isFetching && !isPending} />

      {isPending ? (
        <Box data-testid="archive-loading" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(3,1fr)", md: "repeat(4,1fr)", lg: "repeat(5,1fr)", xl: "repeat(6,1fr)" }, gap: 1 }}>
          {Array.from({ length: 12 }).map((_, i) => <Box key={i} sx={{ aspectRatio: "16/9", borderRadius: "6px", bgcolor: "#141414", animation: "flixPulse 1.4s ease-in-out infinite" }} />)}
        </Box>
      ) : items.length === 0 ? (
        <Box data-testid="archive-empty" sx={{ py: 12, textAlign: "center", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "14px" }}>
          <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 20, mb: 1 }}>Nessun titolo trovato</Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.55)" }}>Prova ad allargare i filtri o a cambiare la ricerca.</Typography>
        </Box>
      ) : (
        <Box data-testid="archive-grid" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(3,1fr)", md: "repeat(4,1fr)", lg: "repeat(5,1fr)", xl: "repeat(6,1fr)" }, columnGap: 1, rowGap: 5 }}>
          {items.filter((i) => i.backdrop_path || i.poster_path).map((item, idx) => (
            <Box key={`${item.type}-${item.tmdbId}-${idx}`} sx={{ position: "relative", zIndex: 1, "&:hover": { zIndex: 30 } }} data-testid={`archive-card-${item.tmdbId}`}>
              <VideoItemWithHover
                video={{ ...item, id: item.tmdbId, name: item.title, genre_ids: item.genre_ids || [] }}
                mediaType={item.type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie}
              />
            </Box>
          ))}
        </Box>
      )}

      <Box ref={sentinel} data-testid="archive-sentinel" sx={{ display: "flex", justifyContent: "center", py: 4, minHeight: 56 }}>
        {hasMore && !isPending && (autoLoad || isFetching ? (
          <CircularProgress size={28} sx={{ color: "#E50914" }} data-testid="archive-loading-more" />
        ) : (
          <Box component="button" type="button" onClick={onMore} data-testid="archive-load-more-button"
            sx={{ px: 3, py: 1.2, borderRadius: "10px", border: "1px solid rgba(255,255,255,0.2)", bgcolor: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600,
              transition: "background-color 200ms ease", "&:hover": { bgcolor: "rgba(255,255,255,0.12)" } }}>
            Cerca altri risultati
          </Box>
        ))}
        {!hasMore && items.length > 0 && <Typography sx={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Hai raggiunto la fine dell'archivio</Typography>}
      </Box>
    </Box>
  );
}
