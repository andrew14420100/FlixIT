"""Guaranteed startup hook for configurable Admin permissions.

Imported from stream_blocklist, which server_core loads before premium.register().
This mirrors the manual-user bootstrap so permission routes and the enforcement
middleware are present even when Python does not auto-load sitecustomize.
"""
from __future__ import annotations


def _install_admin_permission_registration_hook():
    try:
        import premium as premium_module
    except Exception:
        return

    current = getattr(premium_module, "register", None)
    if not callable(current) or getattr(current, "_flixit_admin_permissions_hook", False):
        return

    original_register = current

    def register_with_admin_permissions(
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
            from services.admin_permissions import register_admin_permissions
            register_admin_permissions(app, db, get_current_admin, log_admin_action)
        except Exception as exc:
            print(f"[admin-permissions] guaranteed registration skipped: {exc}")
        return result

    register_with_admin_permissions._flixit_admin_permissions_hook = True
    register_with_admin_permissions._original_register = original_register
    premium_module.register = register_with_admin_permissions


_install_admin_permission_registration_hook()
