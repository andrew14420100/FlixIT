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
        from services.trailers import register_trailer_service

        register_trailer_service(
            app,
            db,
            get_current_admin,
            log_admin_action,
            fetch_tmdb_data,
        )

        # Performance services are mounted here because premium.register runs
        # only after server_core has created the FastAPI app and registered its
        # public catalogue routes. Both installers are idempotent.
        try:
            from services.performance_api import install_performance_api
            install_performance_api(app)
        except Exception:
            pass
        try:
            from services.home_bootstrap import install_home_bootstrap
            install_home_bootstrap(app)
        except Exception:
            pass
        return result

    register_with_trailers._flixit_trailer_hook = True
    register_with_trailers._original_register = original_register
    premium_module.register = register_with_trailers


def _install_full_sc_artwork_catalog_hook():
    """Make the artwork policy prefer the committed full SC catalog.

    Importing the policy here is intentional: ``services`` is initialized before
    ``server.py`` imports ``install_artwork_card_policy``. The hook therefore
    swaps only the SC provider implementation while preserving the existing card
    policy and all other artwork providers.
    """
    try:
        import services.artwork_card_policy as policy_module
        from services.sc_artwork_catalog import install_sc_catalog

        install_sc_catalog(policy_module)
    except Exception:
        # The existing artwork resolver remains fully functional if the optional
        # catalog cannot be installed in a stripped-down/test environment.
        return


_install_trailer_registration_hook()
_install_full_sc_artwork_catalog_hook()
