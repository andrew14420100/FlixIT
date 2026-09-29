"""FlixIT backend startup hooks.

Premium 3/6/12-month prices are monthly rates in the admin UI. Legacy plans may
still have that monthly value stored directly in ``price_cents``; the migration
converts those old records to the one-off checkout total and stores the original
monthly rate as metadata.
"""

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

        # v16 remains the only Italian availability authority, but its Mongo
        # hydration is scheduled after startup so a slow Atlas read can never
        # prevent FastAPI (and therefore the website shell) from becoming ready.
        italian_index_installed = False
        try:
            from services.italian_media_index_v16_fastboot import (
                install_italian_media_index_v16_fastboot,
            )
            italian_index_installed = bool(
                install_italian_media_index_v16_fastboot(app, db)
            )
        except Exception as exc:
            print(f"[italian-index-v16] fastboot registration skipped: {exc}")

        async def install_post_registration_guards():
            # Track selection stays separate from availability. Availability comes
            # only from the prebuilt v16 index once its persisted generation loads.
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

            # Fallback only if registration ordering changes in a future refactor.
            try:
                installed = italian_index_installed or bool(
                    getattr(app.state, "flixit_italian_media_index_v16_fastboot", False)
                )
                if not installed:
                    from services.italian_media_index_v16_fastboot import (
                        install_italian_media_index_v16_fastboot,
                    )
                    install_italian_media_index_v16_fastboot(app, db)
            except Exception as exc:
                print(f"[italian-index-v16] startup fallback skipped: {exc}")

        app.add_event_handler("startup", install_post_registration_guards)
        return result

    register_with_ads._flixit_ads_hook = True
    register_with_ads._original_register = original_register
    premium_module.register = register_with_ads


_install_ads_registration_hook()
