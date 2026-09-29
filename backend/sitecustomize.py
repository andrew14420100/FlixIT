"""FlixIT backend startup hooks.

Premium 3/6/12-month prices are monthly rates in the admin UI. Legacy plans may
still have that monthly value stored directly in ``price_cents``; the migration
converts those old records to the one-off checkout total and stores the original
monthly rate as metadata.

Advertising, manual-user and admin-permission services are attached by wrapping
``premium.register`` before server_core imports it. The existing services
package may wrap the same function afterwards for trailers/artwork; the wrappers
compose cleanly.
"""

import asyncio
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
            register_manual_user_service(
                app,
                db,
                get_current_user,
                get_current_admin,
                log_admin_action,
            )
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
            try:
                from services.vixsrc_italian_audio import install_vixsrc_italian_audio
                install_vixsrc_italian_audio()
            except Exception as exc:
                print(f"[vixsrc-italian-audio] registration skipped: {exc}")

            try:
                import services.strict_audio_evidence as strict_audio
                from services.vixsrc_episode_catalog_paged import install_paged_episode_catalog

                strict_audio.install_strict_audio_evidence(app)
                # Patch the policy with the complete paginated loader before any
                # season snapshot asks for a verdict.
                install_paged_episode_catalog(strict_audio)
                try:
                    await asyncio.wait_for(
                        strict_audio.warm_italian_episode_catalog(),
                        timeout=float(os.environ.get("VIXSRC_EPISODE_STARTUP_WARM_TIMEOUT", "40")),
                    )
                except Exception as exc:
                    print(f"[strict-audio-evidence] catalog warm fallback: {exc}")
            except Exception as exc:
                print(f"[strict-audio-evidence] registration skipped: {exc}")

            try:
                from services.logo_integrity import install_logo_integrity
                install_logo_integrity(app)
            except Exception as exc:
                print(f"[logo-integrity] registration skipped: {exc}")

            try:
                from services.instant_episode_snapshots import install_instant_episode_snapshots
                installed = install_instant_episode_snapshots(app, db)
                if installed:
                    # The v11 route becomes the final route before the prewarmer
                    # discovers the endpoint. This makes prewarm populate the
                    # direct catalogue snapshots instead of the legacy empty
                    # snapshot layer.
                    from services.direct_italian_episode_route_v11 import install_direct_italian_episode_route
                    direct_installed = install_direct_italian_episode_route(app, db)
                    if direct_installed:
                        from services.episode_prewarm_launcher import launch_episode_prewarm
                        launch_episode_prewarm(app, db)
            except Exception as exc:
                print(f"[instant-episode-snapshots] registration skipped: {exc}")

        app.add_event_handler("startup", install_post_registration_guards)
        return result

    register_with_ads._flixit_ads_hook = True
    register_with_ads._original_register = original_register
    premium_module.register = register_with_ads


_install_ads_registration_hook()
