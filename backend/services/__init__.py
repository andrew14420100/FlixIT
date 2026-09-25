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

        # Install quality/language enrichment before the resolver instance is
        # created. This affects trailer worker discovery only and never blocks
        # homepage/card rendering.
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
            from services.trailers.italian_4k_policy import install_italian_4k_result_policy
            if trailer_resolver is not None:
                install_italian_4k_result_policy(trailer_resolver)
        except Exception:
            pass

        try:
            from services.performance_api import install_performance_api
            install_performance_api(app)
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
    """Make StreamingCommunity the first source for the Italian Hero title logo.

    The committed SC artwork catalogue remains the fast first pass. When that
    record has no logo, always perform a small live SC search for the same title
    identity. This recovery is allowed even when the local catalogue returned no
    visual row at all: a real SC title can expose a transparent title treatment
    independently from the archived cover. TMDB artwork is never introduced.
    """
    try:
        import services.artwork_card_policy as policy_module
        import services.official_artwork as artwork_module
        from services.sc_artwork_catalog import install_sc_catalog
        from services.official_artwork import OfficialArtworkResolver

        install_sc_catalog(policy_module)

        version = "official-artwork-v11-sc-logo-always-live"
        policy_module.POLICY_VERSION = version
        artwork_module.SOURCE_VERSION = version

        current_sc = policy_module._streamingcommunity
        if not getattr(current_sc, "_flixit_live_sc_logo_v11", False):
            async def streamingcommunity_with_live_logo(self, identity: dict) -> dict:
                base = await current_sc(self, identity)
                result = dict(base) if isinstance(base, dict) else {}
                if result.get("logo_url"):
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

            streamingcommunity_with_live_logo._flixit_live_sc_logo_v11 = True
            streamingcommunity_with_live_logo._original = current_sc
            policy_module._streamingcommunity = streamingcommunity_with_live_logo

        current_choose_logo = OfficialArtworkResolver._choose_logo
        if not getattr(current_choose_logo, "_flixit_sc_logo_first_v11", False):
            def choose_sc_logo_first(providers):
                for provider in providers or []:
                    if str(provider.get("source") or "") != "streamingcommunity":
                        continue
                    logo = policy_module._safe_url(provider.get("logo_url"))
                    if logo:
                        return logo, "streamingcommunity", "it"
                return current_choose_logo(providers)

            choose_sc_logo_first._flixit_sc_logo_first_v11 = True
            choose_sc_logo_first._original = current_choose_logo
            OfficialArtworkResolver._choose_logo = staticmethod(choose_sc_logo_first)
    except Exception:
        return


_install_trailer_registration_hook()
_install_full_sc_artwork_catalog_hook()
