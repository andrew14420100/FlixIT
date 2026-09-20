# StreamingCommunity artwork catalog

FLIX-IT keeps a metadata-only snapshot of StreamingCommunity artwork in
`backend/data/sc_artwork_catalog.json`. Image binaries are **not** copied into the
repository: each entry stores the SC title identity and the original artwork
filenames (`cover`, `poster`, `cover_mobile`, `background`, `logo`, ...).

`backend/services/sc_artwork_catalog.py` loads this file once and indexes titles
in memory. The existing artwork policy then resolves cards from the local index
before making a live SC search. This removes the old practical ceiling caused by
warming only a limited TMDB candidate pool and allows the same catalog to serve
the whole SC archive.

The GitHub Action `.github/workflows/update-sc-artwork-catalog.yml` rebuilds the
snapshot every day and can also be started manually. The builder reads the SC
archive (`/it/archive`) and, only when the archive is temporarily unavailable,
can bootstrap from public GitHub snapshots containing SC title/image mappings.

Static catalogue cards remain pre-merchandised: `cover` is preferred for
landscape cards, while `poster`/`cover_mobile` is preferred for Top 10 portrait
cards. `background` and `logo` are retained for Hero/detail use and are not
required as a runtime logo overlay on static cards.
