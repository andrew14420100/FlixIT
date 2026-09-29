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
            from services.strict_italian_media import install_strict_italian_media
            install_strict_italian_media(app, db)
        except Exception as exc:
            print(f"[strict-italian-media] registration skipped: {exc}")
        try:
            from services.player_hot_warm import install_player_hot_warm
            install_player_hot_warm(app, db)
        except Exception as exc:
            print(f"[player-hot-warm] registration skipped: {exc}")

        async def install_post_registration_guards():
            # Player resolver itself now requests VixSrc with lang=it. Keep the
            # playlist-level guard as an additional last-mile protection.
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

            # v12 is deliberately installed as the final TV-season route. Do not
            # warm the global VixSrc episode feed here: that feed is not a complete
            # historical archive and was the cause of whole seasons being hidden.
            try:
                from services.episode_availability_v12 import install_episode_availability_v12
                installed = install_episode_availability_v12(app, db)
                if installed:
                    from services.episode_prewarm_launcher import launch_episode_prewarm
                    launch_episode_prewarm(app, db)
            except Exception as exc:
                print(f"[episode-availability-v12] registration skipped: {exc}")

        app.add_event_handler("startup", install_post_registration_guards)
        return result

    register_with_ads._flixit_ads_hook = True
    register_with_ads._original_register = original_register
    premium_module.register = register_with_ads


_install_ads_registration_hook()
