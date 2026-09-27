"""Backend services package.

The trailer system is attached after the existing premium module registers its
routes. This keeps trailer integration isolated from player.py, VixSrc,
MediaFlow and the main movie/episode resolver stack.
"""


def _install_trailer_registration_hook():
    try:
        import premium as premium_module
    except Exception:
        return

    current = getattr(premium_module, "register", None)
    if not current or getattr(current, "_flixit_trailer_hook", False):
        return

    original_register = current

    def register_with_trailers(
        app,
        db,
        get_current_user,
        get_current_admin,
        log_admin_action,
        fetch_tmdb_data,
        enrich_items,
        notify,
    ):
        result = original_register(
            app,
            db,
            get_current_user,
            get_current_admin,
            log_admin_action,
            fetch_tmdb_data,
            enrich_items,
            notify,
        )

        try:
            from services.trailers.sc_youtube_metadata_policy import install_sc_youtube_metadata_policy
            install_sc_youtube_metadata_policy()
        except Exception:
            pass

        try:
            from services.trailers.italian_4k_policy import install_italian_4k_trailer_policy
            install_italian_4k_trailer_policy()
        except Exception:
            pass

        from services.trailers import register_trailer_service

        trailer_resolver = register_trailer_service(
            app,
            db,
            get_current_admin,
            log_admin_action,
            fetch_tmdb_data,
        )

        try:
            from services.trailers.providers import ItalianWebTrailerProvider
            if trailer_resolver is not None and not any(
                getattr(provider, "name", "") == "italian_web"
                for provider in getattr(trailer_resolver, "providers", [])
            ):
                trailer_resolver.providers.insert(1, ItalianWebTrailerProvider())

            from services.trailers import queue_policy as trailer_queue_policy
            trailer_queue_policy.TRAILER_POLICY_VERSION = (
                "direct-multiprovider-web-v5-italian-provider-active"
            )
        except Exception:
            pass

        try:
            from services.trailers.italian_4k_policy import install_italian_4k_result_policy
            if trailer_resolver is not None:
                install_italian_4k_result_policy(trailer_resolver)
        except Exception:
            pass

        # `media_assets` is a TMDB-oriented metadata cache and historically
        # leaked TMDB/legacy logos back into Hero/hover components when SC had no
        # title treatment. Keep all non-SC visual metadata intact, but never
        # publish a logo from this path. Genuine SC logos come from the dedicated
        # SC/official artwork resolver instead.
        try:
            import server_core as core
            current_media_assets = getattr(core, "get_media_assets", None)
            if callable(current_media_assets) and not getattr(current_media_assets, "_flixit_sc_logo_only_v13", False):
                async def media_assets_without_logo(media_type: str, tmdb_id: int, force: bool = False):
                    value = await current_media_assets(media_type, tmdb_id, force=force)
                    if not isinstance(value, dict):
                        return value
                    cleaned = dict(value)
                    for key in (
                        "logo_path",
                        "logo_url",
                        "fallback_logo_path",
                        "netflix_logo_url",
                        "title_logo_path",
                    ):
                        cleaned[key] = None
                    cleaned["logo_source"] = None
                    return cleaned

                media_assets_without_logo._flixit_sc_logo_only_v13 = True
                media_assets_without_logo._original = current_media_assets
                core.get_media_assets = media_assets_without_logo
        except Exception:
            pass

        try:
            from services.performance_api import install_performance_api
            install_performance_api(app)
        except Exception:
            pass
        try:
            from services.artwork_proxy import install_artwork_proxy
            install_artwork_proxy(app)
        except Exception:
            pass
        try:
            from services.home_bootstrap import install_home_bootstrap
            install_home_bootstrap(app)
            from services.home_bootstrap_fast import install_home_bootstrap_fast
            install_home_bootstrap_fast(app)
        except Exception:
            pass
        try:
            from services.streamportal_availability import install_streamportal_availability
            install_streamportal_availability(app, db)
        except Exception:
            pass
        try:
            from services.strict_italian_tv import install_strict_italian_tv_policy
            install_strict_italian_tv_policy(app)
        except Exception:
            pass
        return result

    register_with_trailers._flixit_trailer_hook = True
    register_with_trailers._original_register = original_register
    premium_module.register = register_with_trailers


def _install_full_sc_artwork_catalog_hook():
    """Use StreamingCommunity as the only source of transparent title logos.

    Covers/backdrops may keep their existing source policy, but a title logo is
    published only when it is present in the committed SC catalogue or recovered
    by a strict live SC identity match. If SC has no logo, the UI must show text
    instead of silently falling back to Netflix, TMDB, Apple, Prime or MetaHub.
    """
    try:
        import services.artwork_card_policy as policy_module
        import services.official_artwork as artwork_module
        from services.sc_artwork_catalog import install_sc_catalog
        from services.official_artwork import OfficialArtworkResolver

        install_sc_catalog(policy_module)

        version = "official-artwork-v13-sc-logo-only"
        policy_module.POLICY_VERSION = version
        artwork_module.SOURCE_VERSION = version

        current_sc = policy_module._streamingcommunity
        if not getattr(current_sc, "_flixit_live_sc_logo_v13", False):
            async def streamingcommunity_with_live_logo(self, identity: dict) -> dict:
                base = await current_sc(self, identity)
                result = dict(base) if isinstance(base, dict) else {}
                if result.get("logo_url"):
                    result["logo_source"] = "streamingcommunity"
                    result["logo_locale"] = result.get("logo_locale") or "it"
                    return result

                best_score = 0.0
                best_logo = None
                best_row = None

                for query in policy_module._query_variants(identity):
                    try:
                        response = await self._http().get(
                            policy_module.SC_SEARCH_API,
                            params={"q": query},
                            headers={
                                "Accept": "application/json",
                                "Accept-Language": "it-IT,it;q=0.9,en;q=0.6",
                                "Referer": "https://streamingcommunityz.ninja/",
                            },
                        )
                        if response.status_code != 200:
                            continue
                        rows = policy_module._payload_rows(response.json())
                    except Exception:
                        continue

                    for row in rows:
                        try:
                            score = float(policy_module._match_score(row, identity))
                        except Exception:
                            score = 0.0
                        if score < 0.62 or score < best_score:
                            continue

                        logo = policy_module._image_url(
                            row,
                            "logo",
                            "title_logo",
                            "title-treatment",
                            "title_treatment",
                            "titlelogo",
                            "logo_title",
                        )
                        if not logo:
                            for key in (
                                "logo_url",
                                "logo",
                                "title_logo_url",
                                "title_logo",
                                "title_treatment_url",
                                "title_treatment",
                                "titleTreatment",
                            ):
                                logo = policy_module._asset_url(row.get(key))
                                if logo:
                                    break

                        if logo:
                            best_score = score
                            best_logo = logo
                            best_row = row

                if best_logo:
                    result.update({
                        "source": "streamingcommunity",
                        "provider_id": result.get("provider_id") or (best_row or {}).get("id") or (best_row or {}).get("uuid") or (best_row or {}).get("slug"),
                        "provider_name": result.get("provider_name") or (best_row or {}).get("name") or (best_row or {}).get("title"),
                        "confidence": round(float(min(best_score, 1.0)), 4),
                        "logo_url": best_logo,
                        "logo_locale": "it",
                        "logo_source": "streamingcommunity",
                    })
                return result

            streamingcommunity_with_live_logo._flixit_live_sc_logo_v13 = True
            streamingcommunity_with_live_logo._original = current_sc
            policy_module._streamingcommunity = streamingcommunity_with_live_logo

        current_choose_logo = OfficialArtworkResolver._choose_logo
        if not getattr(current_choose_logo, "_flixit_sc_logo_only_v13", False):
            def choose_sc_logo_only(providers):
                for provider in providers or []:
                    if str(provider.get("source") or "") != "streamingcommunity":
                        continue
                    logo = policy_module._safe_url(provider.get("logo_url"))
                    if logo:
                        return logo, "streamingcommunity", "it"
                return None, None, None

            choose_sc_logo_only._flixit_sc_logo_only_v13 = True
            choose_sc_logo_only._original = current_choose_logo
            OfficialArtworkResolver._choose_logo = staticmethod(choose_sc_logo_only)
    except Exception:
        return


def _install_sc_home_hero_policy():
    """Keep Home hero title treatment SC-only and make SC backdrops renderable."""
    try:
        from services import home_bootstrap as home_module
    except Exception:
        return

    # Force the persistent backend snapshot to rebuild on the first full Home
    # request after this deployment. Otherwise a valid three-day stale snapshot
    # could keep old mixed-source logos alive even though React's cache was reset.
    home_module.SNAPSHOT_VERSION = "instant-home-v6-sc-logo-only-home-fixes"

    current = getattr(home_module, "_hydrate_hero_artwork", None)
    if not callable(current) or getattr(current, "_flixit_sc_home_hero_v13", False):
        return

    async def sc_home_hero(hero):
        result = await current(hero)
        if not isinstance(result, dict):
            return result
        out = dict(result)
        assets = dict(out.get("assets") or {})
        logo_source = str(assets.get("logo_source") or "").strip().lower()
        if logo_source != "streamingcommunity":
            assets["logo_path"] = None
            assets["logo_url"] = None
            assets["fallback_logo_path"] = None
            assets["logo_source"] = None

        if not out.get("customBackdrop"):
            sc_backdrop = (
                assets.get("hero_backdrop_path")
                or assets.get("detail_backdrop_path")
                or assets.get("backdrop_path")
            )
            if sc_backdrop and str(assets.get("hero_backdrop_source") or "").lower() == "streamingcommunity":
                out["customBackdrop"] = sc_backdrop

        out["assets"] = assets
        return out

    sc_home_hero._flixit_sc_home_hero_v13 = True
    sc_home_hero._original = current
    home_module._hydrate_hero_artwork = sc_home_hero


_install_trailer_registration_hook()
_install_full_sc_artwork_catalog_hook()
_install_sc_home_hero_policy()
