"""FlixIT backend startup hooks."""

import os


if os.environ.get("FLIXIT_SKIP_PREMIUM_PRICE_MIGRATION") != "1":
    try:
        import migrate_premium_monthly_prices  # noqa: F401
    except Exception as exc:
        print(f"[premium-price-migration] skipped: {exc}")


def _install_ads_registration_hook():
    try:
        import premium as premium_module
    except Exception as exc:
        print(f"[services] premium hook unavailable: {exc}")
        return

    current = getattr(premium_module, "register", None)
    if not callable(current) or getattr(current, "_flixit_ads_hook", False):
        return

    original_register = current

    def register_with_ads(
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
            from services.ads import register_ad_service
            register_ad_service(app, db, get_current_admin, log_admin_action)
        except Exception as exc:
            print(f"[ads] registration skipped: {exc}")
        try:
            from services.manual_users import register_manual_user_service
            register_manual_user_service(app, db, get_current_user, get_current_admin, log_admin_action)
        except Exception as exc:
            print(f"[manual-users] registration skipped: {exc}")
        try:
            from services.admin_permissions import register_admin_permissions
            register_admin_permissions(app, db, get_current_admin, log_admin_action)
        except Exception as exc:
            print(f"[admin-permissions] registration skipped: {exc}")

        try:
            from services.player_hot_warm import install_player_hot_warm
            install_player_hot_warm(app, db)
        except Exception as exc:
            print(f"[player-hot-warm] registration skipped: {exc}")

        # v17 follows StreamingCommunity's own catalogue hierarchy. It registers
        # routes synchronously but never reads Mongo or contacts SC in this path;
        # hydration/crawling starts only after FastAPI startup.
        sc_index_installed = False
        try:
            from services.sc_native_catalog_v17_safety import install_sc_v17_safety
            install_sc_v17_safety()
            from services.sc_native_catalog_v17 import install_sc_native_catalog_v17
            sc_index_installed = bool(install_sc_native_catalog_v17(app, db))
        except Exception as exc:
            print(f"[sc-native-catalog-v17] registration skipped: {exc}")

        async def install_post_registration_guards():
            # Audio-track preference belongs only to playback. Catalogue
            # membership comes from StreamingCommunity v17, never from VixSrc.
            try:
                from services.vixsrc_italian_audio import install_vixsrc_italian_audio
                install_vixsrc_italian_audio()
            except Exception as exc:
                print(f"[vixsrc-italian-audio] registration skipped: {exc}")

            try:
                from services.logo_integrity import install_logo_integrity
                install_logo_integrity(app)
            except Exception as exc:
                print(f"[logo-integrity] registration skipped: {exc}")

            try:
                installed = sc_index_installed or bool(
                    getattr(app.state, "flixit_sc_native_catalog_v17", False)
                )
                if not installed:
                    from services.sc_native_catalog_v17_safety import install_sc_v17_safety
                    install_sc_v17_safety()
                    from services.sc_native_catalog_v17 import install_sc_native_catalog_v17
                    install_sc_native_catalog_v17(app, db)
            except Exception as exc:
                print(f"[sc-native-catalog-v17] startup fallback skipped: {exc}")

        app.add_event_handler("startup", install_post_registration_guards)
        return result

    register_with_ads._flixit_ads_hook = True
    register_with_ads._original_register = original_register
    premium_module.register = register_with_ads


_install_ads_registration_hook()
