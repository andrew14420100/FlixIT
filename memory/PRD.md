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
