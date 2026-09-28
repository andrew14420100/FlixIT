"""Run the idempotent Premium price normalization whenever the backend Python
runtime starts from this directory.

Premium 3/6/12-month prices are monthly rates in the admin UI. Legacy plans may
still have that monthly value stored directly in ``price_cents``; the migration
converts those old records to the one-off checkout total and stores the original
monthly rate as metadata. Re-running it is safe because migrated plans are
skipped.
"""

import os


# Do not depend on SUPERVISOR_PROCESS_NAME: some Emergent/Supervisor launches do
# not expose it to Python early enough for sitecustomize. The migration is
# idempotent, so running it whenever this backend runtime starts is safe.
if os.environ.get("FLIXIT_SKIP_PREMIUM_PRICE_MIGRATION") != "1":
    try:
        import migrate_premium_monthly_prices  # noqa: F401
    except Exception as exc:
        # A maintenance migration must never prevent the API from starting.
        print(f"[premium-price-migration] skipped: {exc}")
