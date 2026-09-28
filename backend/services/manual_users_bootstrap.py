"""Guaranteed startup hook for admin-created user / first-access routes.

The older sitecustomize hook is kept as a fallback, but Emergent does not always
load sitecustomize from the backend working directory. This module is imported
from a service that server_core always imports before premium.register() runs.
"""
from __future__ import annotations


def _install_manual_user_registration_hook():
    try:
        import premium as premium_module
    except Exception:
        return

    current = getattr(premium_module, "register", None)
    if not callable(current) or getattr(current, "_flixit_manual_users_hook", False):
        return

    original_register = current

    def register_with_manual_users(
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
            from services.manual_users import register_manual_user_service

            register_manual_user_service(
                app,
                db,
                get_current_user,
                get_current_admin,
                log_admin_action,
            )
        except Exception as exc:
            print(f"[manual-users] guaranteed registration skipped: {exc}")
        return result

    register_with_manual_users._flixit_manual_users_hook = True
    register_with_manual_users._original_register = original_register
    premium_module.register = register_with_manual_users


_install_manual_user_registration_hook()
