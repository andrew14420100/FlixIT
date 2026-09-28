"""One-time, idempotent migration for Premium plan prices.

Admin prices are monthly rates. Existing Base/Pro/Unlimited plans created by the
old configurator stored that monthly rate directly in ``price_cents`` even for
3/6/12-month plans. The public Premium page and checkout correctly expect
``price_cents`` to be the one-off total for the selected period.

This script converts only old multi-month configurator plans that do not yet
carry the monthly-rate metadata marker. It is safe to run more than once.
"""

import os
import re

import certifi
from dotenv import load_dotenv
from pymongo import MongoClient

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "Flixit")
META_PREFIX = "__monthly_price_cents="

if not MONGO_URL:
    raise SystemExit("MONGO_URL non configurato")

client = MongoClient(
    MONGO_URL,
    tls=True,
    tlsCAFile=certifi.where(),
    serverSelectionTimeoutMS=10000,
)
client.admin.command("ping")
db = client[DB_NAME]
plans = db["premium_plans"]


def months_for(plan: dict) -> int:
    days = int(plan.get("duration_days") or 0)
    interval = str(plan.get("interval") or "").lower()
    name = str(plan.get("name") or "").lower()
    if days == 90 or "3 mesi" in name:
        return 3
    if days == 180 or "6 mesi" in name:
        return 6
    if days == 365 or interval == "year" or "annuale" in name:
        return 12
    return 1


def is_configurator_plan(plan: dict) -> bool:
    return bool(re.match(r"^(Base|Pro|Unlimited)\s*·\s*", str(plan.get("name") or ""), re.I))


def has_monthly_meta(plan: dict) -> bool:
    return any(str(item or "").startswith(META_PREFIX) for item in (plan.get("features") or []))


changed = 0
for plan in plans.find({}):
    months = months_for(plan)
    if months <= 1 or not is_configurator_plan(plan) or has_monthly_meta(plan):
        continue

    monthly_cents = int(plan.get("price_cents") or 0)
    if monthly_cents <= 0:
        continue

    total_cents = monthly_cents * months
    features = [str(item) for item in (plan.get("features") or []) if not str(item or "").startswith(META_PREFIX)]
    features.append(f"{META_PREFIX}{monthly_cents}")

    plans.update_one(
        {"_id": plan["_id"]},
        {"$set": {"price_cents": total_cents, "features": features}},
    )
    changed += 1
    print(
        f"{plan.get('name')}: {monthly_cents / 100:.2f} €/mese x {months} "
        f"= {total_cents / 100:.2f} € totale"
    )

print(f"Migrazione completata. Piani aggiornati: {changed}")
