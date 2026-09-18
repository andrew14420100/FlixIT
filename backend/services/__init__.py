"""Backend services package.

The trailer system is attached after the existing premium module registers its
routes.  This keeps trailer integration isolated from player.py, VixSrc,
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
        return result

    register_with_trailers._flixit_trailer_hook = True
    register_with_trailers._original_register = original_register
    premium_module.register = register_with_trailers


_install_trailer_registration_hook()
