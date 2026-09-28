"""Small startup hook for one-time Premium price normalization.

Python imports ``sitecustomize`` automatically during interpreter startup when
this backend directory is on ``sys.path``.  Under Supervisor we only run the
Premium migration for the backend process; the migration itself is idempotent,
so subsequent restarts are safe and become no-ops.
"""

import os


def _is_backend_process() -> bool:
    process_name = str(os.environ.get("SUPERVISOR_PROCESS_NAME") or "").strip().lower()
    if process_name == "backend" or process_name.endswith("-backend"):
        return True
    return os.environ.get("FLIXIT_RUN_PREMIUM_PRICE_MIGRATION") == "1"


if _is_backend_process():
    try:
        import migrate_premium_monthly_prices  # noqa: F401
    except Exception as exc:
        # Never prevent the API from starting because a maintenance migration
        # could not run.  The next backend restart will retry automatically.
        print(f"[premium-price-migration] skipped: {exc}")
