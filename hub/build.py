"""Builds the all-sports hub: picks the day's best plays, grades them, writes index.html.

Reads each sport's feed (<sport>/plays.json in this repo, published by that sport's own
cloud run), keeps the official picks in hub/ledger.json, and renders the hub page at the
site root. Standard library only, so the cloud run needs no installs.

    python3 hub/build.py            # normal run
    python3 hub/build.py --now 2026-10-21T11:30   # pretend it's this time (ET), for testing
"""
import argparse
import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB = os.path.join(ROOT, "hub")
LEDGER = os.path.join(HUB, "ledger.json")
ET = ZoneInfo("America/New_York")

# folder, feed sport code, name shown in the app
SPORTS = [("nfl", "NFL", "NFL"), ("cfb", "CFB", "College Football"), ("nba", "NBA", "NBA"),
          ("ncaab", "NCAAB", "College Basketball"), ("nhl", "NHL", "NHL")]
TIER_RANK = {"VIP": 0, "3U": 1, "2U": 2, "1U": 3, "Lean": 4, "Light lean": 5}
FINAL = ("win", "loss", "push", "void")


def load_feeds():
    feeds = {}
    for folder, code, name in SPORTS:
        path = os.path.join(ROOT, folder, "plays.json")
        try:
            with open(path) as f:
                d = json.load(f)
            feeds[code] = {"folder": folder, "name": name, "generated_at": d.get("generated_at"),
                           "plays": d.get("plays", [])}
        except (OSError, ValueError):
            feeds[code] = {"folder": folder, "name": name, "generated_at": None, "plays": []}
    return feeds


def parse_start(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def profit(price):
    if price is None:
        return 100 / 110
    return 100 / -price if price < 0 else price / 100


def stake_of(play, settings):
    return max(float(play.get("units") or 0), settings["min_stake"])


def grade(entry, play):
    """Copy the sport's result onto a ledger entry."""
    st = play.get("status")
    if st not in FINAL:
        return
    entry["status"] = st
    s = entry["stake"]
    entry["result_units"] = round(s * profit(entry["price"]), 3) if st == "win" else \
        (-s if st == "loss" else 0.0)


def select(day, now, feeds, ledger, settings, backfill=False):
    """Fill a day's open slots with the best remaining plays (never replaces a pick).

    backfill=True picks a past day after the fact, from plays the models had already
    logged and graded, using the same rules (the entries are marked "backfilled")."""
    todays = [e for e in ledger if e["date"] == day]
    open_slots = settings["picks_per_day"] - len(todays)
    if open_slots <= 0 or (not backfill and now.hour < settings["lock_hour_et"]):
        return []
    taken_games = {(e["sport"], e["event"], e.get("player") if e["market"] == "prop" else None)
                   for e in todays}
    chosen_ids = {e["id"] for e in ledger}
    cands = []
    for code, feed in feeds.items():
        for p in feed["plays"]:
            start = parse_start(p.get("start"))
            if (p.get("date") != day or p["id"] in chosen_ids
                    or p.get("tier") not in settings["allowed_tiers"]
                    or (p.get("ev") or 0) <= settings["min_ev"]):
                continue
            if backfill:
                if p.get("status") not in ("win", "loss", "push"):
                    continue
            elif p.get("status") != "pending" or start is None or start < now + timedelta(minutes=5):
                continue
            cands.append(p)
    # biggest bets first (3U/VIP, then 2U, then 1U), best expected value within each size
    cands.sort(key=lambda p: (-(p.get("units") or 0), -p["ev"]))
    picked = []
    for p in cands:
        if len(picked) >= open_slots:
            break
        # one bet per game on the game itself; props on different players can share a game
        game = (p["sport"], p["event"], p.get("player") if p["market"] == "prop" else None)
        if game in taken_games:
            continue
        entry = {k: p.get(k) for k in ("id", "sport", "date", "start", "event", "market",
                                       "selection", "player", "line", "price", "model_prob",
                                       "market_prob", "edge_prob", "ev", "edge_display", "tier")}
        entry.update({"slot": len(todays) + len(picked) + 1, "stake": stake_of(p, settings),
                      "locked_at": "backfilled" if backfill else now.strftime("%Y-%m-%d %H:%M ET"),
                      "backfilled": backfill, "status": "pending", "result_units": None})
        picked.append(entry)
        taken_games.add(game)
    return picked


def sport_records(feeds):
    """Each sport's own record on its unit plays (1U and up), from its feed."""
    out = []
    for code, feed in feeds.items():
        unit = [p for p in feed["plays"] if (p.get("units") or 0) >= 1 and p.get("status") in FINAL]
        w = sum(p["status"] == "win" for p in unit)
        l = sum(p["status"] == "loss" for p in unit)
        out.append({"sport": code, "name": feed["name"], "folder": feed["folder"],
                    "w": w, "l": l, "units": round(sum(p.get("result_units") or 0 for p in unit), 2),
                    "updated": feed["generated_at"], "live": bool(feed["plays"])})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--now", help="ET time to pretend it is (testing)")
    ap.add_argument("--backfill", metavar="YYYY-MM-DD",
                    help="fill past days from this date through yesterday (days with no picks)")
    args = ap.parse_args()
    with open(os.path.join(HUB, "settings.json")) as f:
        settings = json.load(f)
    now = datetime.fromisoformat(args.now).replace(tzinfo=ET) if args.now else datetime.now(ET)
    day = now.date().isoformat()

    feeds = load_feeds()
    by_id = {p["id"]: p for f in feeds.values() for p in f["plays"]}
    ledger = json.load(open(LEDGER)) if os.path.exists(LEDGER) else []
    for e in ledger:
        if e["status"] == "pending" and e["id"] in by_id:
            grade(e, by_id[e["id"]])
    if args.backfill:
        d = datetime.fromisoformat(args.backfill).date()
        while d < now.date():
            past = select(d.isoformat(), now, feeds, ledger, settings, backfill=True)
            for e in past:
                grade(e, by_id[e["id"]])
            ledger += past
            d += timedelta(days=1)
    new = select(day, now, feeds, ledger, settings)
    ledger += new
    ledger.sort(key=lambda e: (e["date"], e["slot"]))
    with open(LEDGER, "w") as f:
        json.dump(ledger, f, indent=1)

    payload = {"generated_at": now.strftime("%Y-%m-%dT%H:%M"), "today": day,
               "settings": settings, "ledger": ledger, "sports": sport_records(feeds),
               "folders": {code: f["folder"] for code, f in feeds.items()},
               "names": {code: f["name"] for code, f in feeds.items()}}
    with open(os.path.join(HUB, "template.html")) as f:
        page = f.read().replace("/*HUB*/null", json.dumps(payload))
    with open(os.path.join(ROOT, "index.html"), "w") as f:
        f.write(page)
    graded = [e for e in ledger if e["status"] in FINAL]
    print(f"Hub: {len(ledger)} official plays ({len(new)} new today, {len(graded)} graded); "
          f"feeds: " + ", ".join(f"{c} {len(f['plays'])}" for c, f in feeds.items()))


if __name__ == "__main__":
    main()
