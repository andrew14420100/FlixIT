from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if new in text:
        print(f"[ok] {path}: patch already applied")
        return
    if old not in text:
        raise SystemExit(f"Expected source block not found in {path}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"[patched] {path}")


# HERO: an inline hero payload may contain a backdrop but no logo.  Previously
# that disabled the automatic SC artwork resolver entirely, so the UI fell back
# to a plain <h1>.  Always resolve the exact title and merge the SC logo into
# the inline payload when the latter does not provide one.
replace_once(
    "frontend/src/components/HeroSection.tsx",
    '''  const automaticAssets = useAutomaticMediaAssets(\n    { id: featuredId, type: typeSlug },\n    featuredMediaType,\n    !skipQueries && !inlineAssets\n  );\n  const assets = inlineAssets || automaticAssets || {};''',
    '''  const automaticAssets = useAutomaticMediaAssets(\n    {\n      id: featuredId,\n      type: typeSlug,\n      title: detailData?.name || detailData?.title || heroSettings?.customTitle || "",\n      original_title: detailData?.original_name || detailData?.original_title || "",\n    },\n    featuredMediaType,\n    !skipQueries\n  );\n  const assets = useMemo(\n    () => ({\n      ...(automaticAssets || {}),\n      ...(inlineAssets || {}),\n      logo_path: inlineAssets?.logo_path || automaticAssets?.logo_path || null,\n      fallback_logo_path:\n        inlineAssets?.fallback_logo_path || automaticAssets?.fallback_logo_path || null,\n      backdrop_path:\n        inlineAssets?.backdrop_path || automaticAssets?.backdrop_path || null,\n      titled_backdrop_path:\n        inlineAssets?.titled_backdrop_path || automaticAssets?.titled_backdrop_path || null,\n      hero_backdrop_path:\n        inlineAssets?.hero_backdrop_path || automaticAssets?.hero_backdrop_path || null,\n      detail_backdrop_path:\n        inlineAssets?.detail_backdrop_path || automaticAssets?.detail_backdrop_path || null,\n    }),\n    [automaticAssets, inlineAssets]\n  );''',
)

# BACKEND: the committed catalog contains its actual CDN.  Use that instead of
# a stale hard-coded/default domain when converting logo/poster filenames.
replace_once(
    "backend/services/sc_artwork_catalog.py",
    '''    def load(self) -> int:\n        if self.loaded:\n            return len(self.records)\n        self.loaded = True\n        try:\n            payload = json.loads(self.path.read_text(encoding="utf-8"))\n            rows = payload.get("titles") if isinstance(payload, dict) else payload''',
    '''    def load(self) -> int:\n        global SC_CDN_BASE\n        if self.loaded:\n            return len(self.records)\n        self.loaded = True\n        try:\n            payload = json.loads(self.path.read_text(encoding="utf-8"))\n            if isinstance(payload, dict):\n                catalog_cdn = str(payload.get("cdn_base_url") or "").strip()\n                if catalog_cdn:\n                    SC_CDN_BASE = catalog_cdn.rstrip("/") + "/"\n            rows = payload.get("titles") if isinstance(payload, dict) else payload''',
)

# TOP 10 must never treat a landscape SC cover as a vertical poster.
replace_once(
    "backend/services/sc_artwork_catalog.py",
    '        keys = ("poster", "cover_mobile", "poster_mobile", "cover")',
    '        keys = ("poster", "poster_mobile", "cover_mobile")',
)

# Give Top 10 a much deeper candidate reserve.  With the complete local SC
# catalog this is cheap and lets us fill all ten ranks using genuine posters.
replace_once(
    "frontend/src/components/Top10Slider.tsx",
    "      .slice(0, 60);",
    "      .slice(0, 240);",
)

# Never render a naked Top 10 heading with an empty slider while artwork is
# resolving (or if one batch is briefly unavailable).
replace_once(
    "frontend/src/components/Top10Slider.tsx",
    "        {published.length === 0 && artworkBatch.isFetching ? (",
    "        {published.length === 0 ? (",
)

print("SC artwork UI fixes applied successfully")
