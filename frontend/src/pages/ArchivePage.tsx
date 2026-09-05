// @ts-nocheck
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { APP_BAR_HEIGHT } from "src/constant";
import ArchiveFilters, { FILTER_KEYS } from "src/components/archive/ArchiveFilters";
import ArchiveGrid from "src/components/archive/ArchiveGrid";

const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));

export function Component() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || null])), [params]);
  const sort = params.get("sort") || "popularity";

  const { data: options } = useQuery({ queryKey: ["archive-options"], queryFn: () => fetchJson("/api/public/archive/options"), staleTime: Infinity });

  const queryString = useCallback((page) => {
    const qs = new URLSearchParams();
    FILTER_KEYS.forEach((k) => filters[k] && qs.set(k, filters[k]));
    qs.set("sort", sort);
    qs.set("page", String(page));
    return qs.toString();
  }, [filters, sort]);

  const { data, isPending, isFetching, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ["archive", filters, sort],
    queryFn: ({ pageParam = 1 }) => fetchJson(`/api/public/archive?${queryString(pageParam)}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last?.hasMore ? (last.page || 1) + 1 : undefined),
    staleTime: 5 * 60 * 1000,
  });

  const update = useCallback((patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null || v === undefined || v === "" ? next.delete(k) : next.set(k, String(v))));
    setParams(next, { replace: true });
  }, [params, setParams]);

  const onMore = useCallback(() => { if (hasNextPage && !isFetching) fetchNextPage(); }, [hasNextPage, isFetching, fetchNextPage]);

  return (
    <Box data-testid="archive-page" sx={{ minHeight: "100vh", bgcolor: "#050505", pt: `${APP_BAR_HEIGHT + 28}px`, pb: 8, px: { xs: "20px", sm: "40px" } }}>
      <Box sx={{ mb: 3 }}>
        <Typography component="h1" data-testid="archive-title" sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: { xs: 26, md: 32 }, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
          Archivio
        </Typography>
        <Typography sx={{ color: "rgba(255,255,255,0.55)", fontSize: 15, mt: 1 }}>Tutto il catalogo doppiato in italiano, con filtri avanzati.</Typography>
      </Box>

      <ArchiveFilters options={options} filters={filters} onChange={(k, v) => update({ [k]: v })} onReset={() => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))} />

      <ArchiveGrid
        pages={data?.pages}
        total={data?.pages?.[0]?.total_estimate || 0}
        sort={sort}
        sorts={options?.sorts || [{ key: "popularity", label: "Popolarità" }]}
        onSort={(v) => update({ sort: v })}
        isFetching={isFetching}
        isPending={isPending}
        hasMore={Boolean(hasNextPage)}
        onMore={onMore}
      />
    </Box>
  );
}
