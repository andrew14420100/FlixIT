# FlixIT - PRD (Product Requirements Document)

## Problem Statement
Clone and run https://github.com/andrew14420100/FlixIT.git - Netflix/StreamingCommunity-style streaming platform with TMDB integration.

## Architecture
- **Frontend**: React + TypeScript + MUI + Tailwind + react-slick (CRA with craco)
- **Backend**: FastAPI + Python + MongoDB
- **External API**: TMDB for content data, YouTube for trailers

## Core Features Implemented

### Iteration 1 (2026-04-14)
- Cloned and set up FlixIT repo
- Fixed card expansion z-index (info panel stays above other sections)
- Removed white margins on sides
- Added spacing between cards and section titles
- Card hover expansion with info panel

### Iteration 2
- Increased card expansion to scale(1.5)
- Top 10 Netflix-style with large numbers + portrait posters
- Uniform center expansion for all cards
- Custom 404 error page

### Iteration 3
- Top 10 hover effects with backdrop + info panel
- Card size adjusted (6 per row)
- Scroll-to-top on navigation

### Iteration 4
- Trailer autoplay after 5 seconds of hover (YouTube iframe)
- Logo overlay in bottom-left (appears with trailer)
- Info panel matching StreamingCommunity: "Valutazione X.X - YYYY - XXmin [12+]"
- Circular buttons: play(filled), add(outlined), star(outlined), expand(outlined)

### Iteration 5-6
- Admin-driven homepage sections system
- 30 predefined sections available from admin dropdown
- Genre-based sections with correct TMDB genre IDs
- Proper endpoint mapping: trending, latest, top10, upcoming, genre discover, popular, top_rated, now_playing, airing_today, on_the_air
- TV shows AND movies support
- Public /api/public/sections endpoint
- /api/admin/available-sections for predefined list
- /api/admin/sections/add-predefined for quick add
- /api/public/tmdb/upcoming endpoint
- /api/public/tmdb/airing_today endpoint
- /api/public/tmdb/genre/{id}/{type} endpoint

### Iteration 7 (2026-06 - restyling StreamingCommunity-like)
- Hero: altezza 100vh, logo/descrizione/pulsanti alzati (bottom 44%), prime righe sovrapposte al fondo hero (mt -31vh). Nessuna barra nera: trailer con `TrailerPlayer` (iframe YouTube "cover" + zoom 1.38 che nasconde letterbox, barra titolo e watermark). Badge età reale da TMDB (certification).
- Pipeline media uniforme (backend): `get_media_assets()` + `enrich_items()` -> ogni item delle liste ha `titled_backdrop_path`, `logo_path`, `trailer_key`, `runtime`, `number_of_seasons`, `certification`. Cache Mongo `media_assets` (14 gg). Endpoint `GET /api/public/media-assets/{movie|tv}/{id}`.
- Card orizzontali: backdrop "con titolo" (TMDB it/en) oppure backdrop pulito + logo in overlay.
- Hover unificato `ExpandedCard` (card normali + Top 10): immagine/trailer dopo 5s + logo + mute, pulsanti Play(bianco)/+/★/⌄, "Valutazione X - anno - durata/stagioni [età]", generi in italiano. Posizionamento edge-aware (`useHoverExpand`): prima card -> ancorata a sinistra, ultima -> a destra.
- Top 10: numeri grandi + poster verticali 210px, slider react-slick, stesso hover.
- Infinite scroll homepage: sezioni admin in ordine, poi righe automatiche per genere ("Genere · Film" / "Genere · Serie TV") dai template predefiniti non ancora configurati. `GET /api/public/available-sections`.
- Menu: Home, Serie TV, Film, Archivio, Premium, Richiedi un titolo -> le 5 voci aprono `ComingSoonPage` ("Sezione non disponibile" / "In arrivo prossimamente"). Footer solo "FlixIT © anno".
- Genere endpoint supporta `?origin_country=KR` (Korean drama). Generi RTK in it-IT.
- NOTA: estrazione diretta dello stream (yt-dlp) NON percorribile: YouTube risponde LOGIN_REQUIRED/403 dagli IP datacenter -> si usa embed YouTube croppato.
- Test: /app/test_reports/iteration_2.json (backend 100%, frontend 100%).

### Iteration 8 (2026-06 - player fix + catalogo vixsrc + rifiniture)
- **BUG PLAYER RISOLTO** (`WatchPage.tsx`): causa = URL iframe vixsrc ricalcolato a ogni render con `startAt` da ref aggiornata in async -> reload video + entry nella history del browser. Ora: posizione di ripresa risolta UNA volta prima del mount (locale + backend, timeout 2.5s), URL memoizzato, `key` sull'iframe, progresso reale da PLAYER_EVENT (currentTime/duration), salvataggio ogni 15s/pausa/ended/unmount, soglia Continua a guardare 10s (anche backend). Tasto Indietro: `navigate(-(1+extra))` saltando le entry aggiunte dall'iframe. Test: iteration_3.json.
- **Catalogo solo vixsrc**: `refresh_vixsrc_catalog()` (lista https://vixsrc.to/api/list/{movie,tv}/?lang=it, Mongo `vixsrc_catalog`, refresh 12h + loop startup), `filter_available()` su tutte le liste tranne "In arrivo"; `fetch_tmdb_pages()` prende 2-3 pagine per riempire le righe. API `POST /api/public/availability`, `GET /api/public/availability/{type}/{id}`. Frontend `hooks/useAvailability.ts` filtra ricerca header, "Simili" nel dettaglio e griglia generi.
- **Trailer StreamingCommunity**: `GET /api/public/trailer/{type}/{id}` -> SC (search API + pagina titolo, `data-page`/`slider-trailer`, YouTube id) se `sc_base_url` configurato in Admin > Impostazioni, altrimenti TMDB. Cache `sc_trailer_key`/`sc_checked_at` in media_assets. Dominio SC non trovato/raggiungibile dai server: campo lasciato vuoto.
- **Admin > Impostazioni** (`/admin/settings`): conteggi catalogo vixsrc + refresh, dominio SC. API `GET/PUT /api/admin/settings`, `POST /api/admin/settings/refresh-catalog`.
- **Hover**: animazione "grow in place" (scala progressiva 320ms da/verso la card, pannello in fade, ritorno fluido al leave) mantenendo pannello Play/+/★/valutazione; `data-state open|closed`.
- **Top 10**: poster alti esattamente quanto le card orizzontali (`--card-h` da larghezza reale layout), numeri SVG misurati con getBBox alti quanto il poster, 7 visibili.
- Titoli righe allineati al bordo sinistro delle card (`.row-title` 46px).
- Menu avatar: Account, La mia lista, Esci/Accedi. Avatar illustrati stile Netflix (`/public/avatars/*.webp`, `config/avatars.ts`) in header e selezionabili in Account.
- Test: iteration_4.json (backend 100%, frontend 100%).

## Admin Credentials
- Email: admin@admin.com
- Password: admin123

## Available Section Types (Admin)
I titoli del momento, Aggiunti di recente, Top 10 titoli oggi, In arrivo, Animazione, Mistero, Western, Avventura, Dramma, Sci-Fi & Fantasy, Famiglia, Fantascienza, Musica, Guerra, Action & Adventure, Storia, Reality, Azione, Televisione film, Thriller, Documentario, Horror, Korean drama, War & Politics, Kids, Romance, Soap, Commedia, Crime, Fantasy

## Backlog / Next Tasks

### Iteration 10 (2026-06 - Home UI/UX, catalogo, auth modal, logo, trailer puliti)
- Home: spacing righe `{xs:4.5, md:6}`; righe genere UNICHE film+serie (`/api/public/tmdb/genre/{id}/mixed`, mapping `genre_pair` movie<->tv, templates `AVAILABLE_SECTIONS` tutti `mixed`, rimossi doppioni per tipologia).
- Top 10: poster `--top10-h = card-h*1.27`, 6 slide, numeri alti quanto il poster con overlap -24px.
- Filtro "solo doppiati in italiano": `is_on_vixsrc` rigoroso (catalogo vixsrc `lang=it`), applicato a righe, ricerca (`/api/public/search`), hero (fallback al primo trending disponibile, `fallback:true`), availability. "In arrivo" escluso per scelta. Fail-open SOLO se il catalogo non è mai stato caricato (log warning).
- Dinamismo: righe home con react-query (`refetchInterval` 10 min + focus), cache TMDB 1h in memoria (`_tmdb_cache`), catalogo vixsrc ogni 6h.
- Auth: modal full-screen (`components/auth/AuthModal.tsx`, `AuthForm.tsx`, store `store/authModal.ts`), bottone "Accedi" in header, `/account` da sloggato = solo prompt. Design da `/app/design_guidelines.json`.
- Logo: wordmark SVG FLIX(rosso gradient)▸IT(bianco), Unbounded 900 (`components/Logo.tsx`, `Wordmark`).
- Trailer: DetailPage hero usa `TrailerPlayer` (crop, nessuna UI YouTube, niente letterbox), tab Trailer con `CleanTrailer` (controlli propri, fallback "Trailer non disponibile" su onError o se non parte entro 9s), "Altri video" riproduce in-page; tasti mute ingranditi (hero 54px, dettaglio 58px, card 44px).
- Test: iteration_6.json backend 12/12, frontend OK. Nota: YouTube blocca alcuni embed da IP datacenter -> mostrato il fallback.
- NON fatto (scelta): estrazione stream vixsrc / player proprio su stream pirata.

### Iteration 9 (2026-06 - estrazione e avvio in nuovo ambiente + overlay player)
- Repo clonato in /app; `.env` ricostruiti: backend `MONGO_URL`, `DB_NAME`(=test_database, valore dell'ambiente), `TMDB_API_KEY` (token v4 dell'utente), `JWT_SECRET`; frontend `REACT_APP_BACKEND_URL` (URL preview; in locale -> http://localhost:8001).
- `fetch_tmdb_data`: supporto token v4 (header `Authorization: Bearer`) se la chiave inizia con `eyJ`, altrimenti `api_key` v3.
- Rimosso `frontend/jsconfig.json` residuo del template (conflitto con `tsconfig.json`, CRA non partiva).
- Sezioni home seedate via API admin: I titoli del momento, Aggiunti di recente, Top 10 titoli oggi, In arrivo.
- Bug sospetto `check_vixsrc_with_cache`/`vixsrc_cache`: NON riprodotto (forward reference risolta a runtime, nessun 500). Nessuna modifica.
- Player: `components/watch/PlayerInfoOverlay.tsx` — titolo + "S1:E1 Nome episodio" in basso a sinistra sopra i controlli vixsrc, tasto "Prossimo episodio" (da `/api/public/tv/{id}/season/{s}`), auto-hide 5s, riappare su eventi play/pause/seeked del player. `WatchPage` rimonta per episodio (key).
- Deciso: NO scraping dello stream vixsrc / player proprio (fonte non autorizzata). Controlli interni dell'iframe non restilizzabili (cross-origin).
- Test: iteration_5.json (backend 7/7, frontend 100%). Riproduzione video: dipende da vixsrc.to, non nel criterio di accettazione.
- P0: conferma utente su player (nessun riavvio) e trailer hover/hero nel browser reale
- P1: inserire il dominio StreamingCommunity attuale in Admin > Impostazioni per attivare i trailer SC
- P1: pagine reali per Serie TV / Film / Archivio / Premium / Richiedi un titolo (ora placeholder)
- P1: pulsanti "+" e "★" dell'hover collegati a Lista/Preferiti utente
- P1: toggle admin per disattivare le righe automatiche dell'infinite scroll
- P2: hover StreamingCommunity-style anche su HorizontalCard (MyList) e ContinueWatching
- P2: User authentication integration with watch history

### Iteration 9 (2026-09 - import & avvio su nuovo workspace Emergent)
- Repo clonato da GitHub e copiato in /app (backend, frontend, scripts, tests). `.env` NON presenti nel repo (gitignore ok): i valori sono stati impostati localmente.
- Env backend (`/app/backend/.env`): MONGO_URL, DB_NAME, TMDB_API_KEY, JWT_SECRET, EMERGENT_LLM_KEY (storage allegati ticket).
- Env frontend (`/app/frontend/.env`): REACT_APP_BACKEND_URL, REACT_APP_TMDB_V3_API_KEY, REACT_APP_API_ENDPOINT_URL.
- Rimosso `frontend/jsconfig.json` residuo del template (CRA rifiuta jsconfig + tsconfig insieme). Nessun altro cambio di codice.
- Seed dati: 4 sezioni predefinite (I titoli del momento, Aggiunti di recente, Top 10 titoli oggi, In arrivo) via admin API.
- Test backend: 34/34 endpoint OK (health, auth utente/admin, sezioni, TMDB trending/genre, top10, search, dettaglio, trailer, availability, lista, watch-progress). Pytest repo: 67/72 (5 fail solo per dati assenti su DB nuovo: utente di test, viste, assert stale su rating 9 vs 10).
- Pytest richiede `REACT_APP_BACKEND_URL` come variabile d'ambiente: `REACT_APP_BACKEND_URL=<url> python -m pytest tests`.
- Scraper vixcloud/.m3u8 richiesto dall'utente: NON implementato (bypass anti-bot per contenuti non autorizzati).

### Iteration 10 (2026-09 - player nativo + risoluzione stream lecita)
- `backend/player.py`: `GET /api/player/movie/{id}`, `GET /api/player/tv/{id}/{s}/{e}` -> `{success, stream, type: hls|mp4, source: admin|archive}`. Gerarchia: 1) `stream_sources` (admin) 2) Internet Archive (match esatto titolo+anno, collezioni pubblico dominio, mp4 h264 preferito, HEVC penalizzato) 3) `{success:false, reason:not_found}`. Cache Mongo `stream_cache` (hit 7gg / miss 12h).
- Admin: `GET /api/admin/contents/{id}/streams`, `PUT /api/admin/contents/{id}/stream[?media_type=]` body `{stream_url, season?, episode?}`, `DELETE .../stream?season=&episode=`. UI: Admin > Contenuti > icona Play -> dialog "Stream video".
- `CustomVideoPlayer.tsx`: hls.js + fallback nativo Safari, traccia audio IT auto (MANIFEST_PARSED), overlay MUI (play/pausa, +-10s, volume, seekbar, tempi, fullscreen, prossimo episodio, menu lingue), auto-hide 3s, resume localStorage `flixit_player_time:<key>`, tasti Spazio/K, F, M, frecce.
- `WatchPage.tsx`: iframe vixsrc rimosso; CircularProgress "Ricerca dello stream" -> player | "Stream non disponibile" + Indietro | errore. "Continua a guardare" (localStorage + backend) invariato, alimentato dai timeupdate reali.
- Demo: tmdbId 10378 (Big Buck Bunny, CC-BY) ha stream admin webm; 10331/653/19/3085 risolti da Internet Archive.
- Nota test: Chromium headless senza H.264 -> mp4 IA non riproducibili nel browser di test (ok nei browser reali).
- Scraping/bypass anti-bot vixcloud.co: RIFIUTATO, non implementato.

### Iteration 11 (2026-09)
- Toggle `player_public_domain_fallback` (app_settings, default OFF) esposto in GET/PUT `/api/admin/settings` (`public_domain_fallback`, `stream_sources_count`); PUT svuota `stream_cache`. UI: Admin > Impostazioni > card "Player nativo" (Switch rosso). Gerarchia player: admin -> [toggle ON] Internet Archive -> Stream non disponibile.
- Stream demo Big Buck Bunny rimosso; nessuna stream_source residua.
- Fix: `src/store/adminStore.js` (codice legacy non usato) conteneva sintassi TS in un .js -> rimossa annotazione (parser error nei linter).
- Rifiutato di nuovo: scraping/bypass vixcloud.co, import automatico del suo catalogo.

### Iteration 12 (2026-09 - refactor architettura resolver modulari)
- Player rifattorizzato da `player.py` monolitico a moduli:
  - `services/resolvers/base.py`: `BaseResolver` (ABC, `resolve(tmdb_id, season, episode, media_type)`), `ResolveContext`, `stream_type_for`.
  - `services/resolvers/admin_source.py`: `AdminSourceResolver` (always_active, primo, legge `stream_sources`).
  - `services/resolvers/internet_archive.py`: `InternetArchiveResolver` (configurabile, toggle `player_public_domain_fallback`).
  - `services/resolver_registry.py`: `ResolverRegistry` (register/order/attivazione, cache Mongo TTL configurabile - success default 2h, miss 15min; always_active forzati in testa).
  - `player.py`: facade (router, CRUD stream_sources, `resolve_stream` -> registry).
- Admin > Impostazioni: GET/PUT `/api/admin/settings` ora espone `player_resolvers[]`, `cache_ttl_hours`, `public_domain_fallback`; PUT accetta `cache_ttl_hours` e `resolver_order` e svuota la cache. Setting keys: `player_cache_ttl_hours`, `player_resolver_order`.
- Test backend iter 12: 48/48 OK. Stato finale: toggle OFF, TTL 2h, nessuna stream_source.
- Rifiutato ancora: resolver vixcloud/vixsrc (scraping/bypass). Non implementato.

### Iteration 13 (2026-09 - pagine Film e Serie TV con filtri per genere)
- Nuovo componente riutilizzabile `src/components/CatalogPage.tsx`: titolo, barra filtri (categorie predefinite COMMON_TITLES/TV_TITLES + generi TMDB), griglia con scorrimento infinito (slice `discover`), stesse card hover (VideoItemWithHover) e filtro disponibilita vixsrc.
- `src/pages/FilmPage.tsx` (`/film`, movie) e `src/pages/SeriePage.tsx` (`/serie-tv`, tv); rotte aggiunte in `routes/index.tsx`; `/film` e `/serie-tv` rimossi da PLACEHOLDER_SECTIONS (non piu "Coming soon"). Le voci menu header puntavano gia a questi path.
- Solo frontend, nessuna modifica backend. Verificato via screenshot: filtri categoria/genere aggiornano la griglia (Film: Popolari/Azione; Serie: Popolari/Animazione).
- Trailer da streamingcommunityz.taxi: RIFIUTATO estendere/puntare lo scraper verso quel dominio (sito pirata). I trailer restano da TMDB (trailer ufficiali YouTube). La feature `sc_base_url` preesistente nel repo non e stata collegata a domini piratati.

### Iteration 13 (2026-09 - import su nuovo workspace + MediaFlow Proxy)
- Repo clonato in /app; `.env` ricreati (backend: MONGO_URL, DB_NAME, CORS_ORIGINS, JWT_SECRET; frontend: REACT_APP_BACKEND_URL). Rimosso `frontend/jsconfig.json`. Superadmin e sezioni home seedati automaticamente allo startup.
- Superadmin: `admin@admin.com` / `Admin123!` (reset password forzato al primo login, `must_reset_password:true`).
- **MediaFlow Proxy** (`backend/services/mediaflow.py`): settings `mediaflow_url`, `mediaflow_api_password`, `mediaflow_enabled` in `app_settings`; esposti in GET/PUT `/api/admin/settings` (+ `mediaflow_active`), `POST /api/admin/settings/mediaflow/test` (ping `/health`). `ResolverRegistry._route()` incapsula lo stream a tempo di lettura (cache conserva l'URL diretto -> cambio impostazioni immediato): HLS -> `/proxy/hls/manifest.m3u8?d=..&api_password=..`, MP4 -> `/proxy/stream?d=..`. Risposta player: `stream`, `original_stream`, `proxied`. Fallback: URL vuoto o switch off -> URL originale.
- Admin > Impostazioni: card "MediaFlow Proxy" (URL, password, switch, Testa connessione, Salva, chip stato).
- Rifiutato: integrazione vixsrc-scraper (fonte non autorizzata).
- Test: iteration_8.json (backend 9/9, frontend OK).
- Fix (iteration_9): `services/mediaflow.py` era stato sovrascritto manualmente (persi `wrap_stream`/`get_config`/`URL_KEY`) -> 500 su `/api/player/*`. Modulo ripristinato; test 9/9 + UI "Stream non disponibile" OK. L'utente ha configurato MediaFlow su Render (`https://mediaflow-proxy-deploy.onrender.com`, health OK). File utente `services/vixsrc.py` e rotta `/api/stream/vixsrc` NON integrati/supportati (fonte non autorizzata).
- "Stream non disponibile" (iteration_10): comportamento atteso senza sorgenti (0 stream_sources, fallback IA off). Aggiunta sorgente demo lecita TMDB 10378 Big Buck Bunny (CC-BY, mux HLS) -> riprodotta via MediaFlow Render (`proxied:true`). Health check MediaFlow timeout 6s -> 20s (cold start Render). Test 5/5.

### Iteration 14 (2026-09 - Addon Stremio nella catena del player)
- `services/stremio.py`: client protocollo Stremio (`/manifest.json`, `/stream/{movie|series}/{imdb}[:s:e].json`), TMDB->IMDb via `external_ids` (cache Mongo `external_ids`), parser (solo `url` http(s); infoHash/ytId/externalUrl ignorati; `behaviorHints.proxyHeaders.request` -> `headers`), `pick_best` (HLS web-ready > MP4). Settings `stremio_addon_url`, `stremio_enabled`.
- `services/resolvers/stremio_addon.py`: `StremioAddonResolver` registrato tra admin_source e internet_archive.
- API: GET `/api/streams/{movie|tv}/{tmdb_id}?season&episode&proxy=true` (lista completa, 404 gestiti: addon non configurato / IMDb assente / addon irraggiungibile / nessuno stream; 400 tv senza s/e), POST `/api/admin/settings/stremio/test` (manifest: name/version/types/idPrefixes/supports_stream), settings in GET/PUT `/api/admin/settings`.
- Admin > Impostazioni: card "Addon Stremio" (URL, switch, Testa addon, Salva, chip).
- `backend/.env`: aggiunta `TMDB_API_KEY`. Mock addon per test: `tests/mock_stremio_addon.py` (porta 9876).
- Test: iteration_11.json (backend 15/15, frontend OK).


### Iteration 15 (2026-06 - integrazione VixSrc + player funzionante)
- **VixSrc come sorgente principale del player** (`services/resolvers/vixsrc.py`, `VixSrcResolver`): porta 2026 della logica di https://github.com/Schumynet/vixsrc-without-embed. Flusso: `GET /api/{movie|tv}/{id}[/{s}/{e}]` (JSON `src` = URL embed) -> pagina embed -> `window.masterPlaylist` ({token, expires, url}) + `window.canPlayFHD` -> URL playlist finale con token/expires/(h=1). Registrato subito dopo `admin_source` (quindi sorgente predefinita per tutti i titoli). Toggle `vixsrc_enabled` (default ON) in GET/PUT `/api/admin/settings`.
- **Proxy HLS interno** (`services/proxy.py`, router `/api/proxy`): vixsrc richiede `Referer` che il browser non può impostare. `/api/proxy/hls?d=<b64>&h_referer=..` scarica il manifest server-side (iniettando gli header), riscrive OGNI URL figlio (varianti, audio, chiave AES `EXT-X-KEY URI`, segmenti) verso il proxy; `/api/proxy/seg` fa da passthrough in streaming (supporta Range). CORS `*`. Gli URL prodotti sono root-relative (`/api/proxy/...`) così funzionano sia per il fetch iniziale sia per hls.js (stessa origin via ingress).
- **Routing** (`services/resolver_registry.py::_route`): MediaFlow ha precedenza se configurato+abilitato; altrimenti gli stream con `headers` (o `source=vixsrc`) passano dal proxy interno; gli altri restano diretti.
- **Fix player** (`CustomVideoPlayer.tsx`): usa hls.js quando `Hls.isSupported()` (Chrome/Firefox/Edge), native solo come fallback (Safari/iOS). Prima preferiva erroneamente il native se `canPlayType('application/vnd.apple.mpegurl')` era truthy ('maybe' su Chromium) -> "Impossibile riprodurre il video".
- Verificato: `/api/player/movie/27205` (Inception) e `/api/player/tv/1399/1/1` (GoT) risolvono via VixSrc; catena HLS completa (master -> variante -> chiave AES-128 -> segmenti) servita dal proxy con Referer; riproduzione reale nel browser OK (durata 2:27:56, readyState 4, 14 segmenti caricati). Audio italiano auto-selezionato.
- Superadmin seedato: `admin@admin.com` / `Admin123!` (reset forzato al primo login). TMDB key di default nel repo -> catalogo funzionante.
