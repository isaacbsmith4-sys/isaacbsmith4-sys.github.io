"""Builds the all-sports hub: picks the day's best plays, grades them, writes index.html.

Reads each sport's feed (<sport>/plays.json in this repo, published by that sport's own
cloud run), keeps the official picks in hub/ledger.json, and renders the hub page at the
site root. Standard library only, so the cloud run needs no installs.

    python3 hub/build.py            # normal run
    python3 hub/build.py --now 2026-10-21T11:30   # pretend it's this time (ET), for testing
    python3 hub/build.py --my-picks ~/Desktop/my-picks/picks.json   # include your own picks
"""
import argparse
import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB = os.path.join(ROOT, "hub")
import sys
sys.path.insert(0, HUB)
LEDGER = os.path.join(HUB, "ledger.json")
ET = ZoneInfo("America/New_York")

# folder, feed sport code, name shown in the app
SPORTS = [("nfl", "NFL", "NFL"), ("cfb", "CFB", "College Football"), ("nba", "NBA", "NBA"),
          ("ncaab", "NCAAB", "College Basketball"), ("nhl", "NHL", "NHL")]
TIER_RANK = {"VIP": 0, "3U": 1, "2U": 2, "1U": 3, "Lean": 4, "Light lean": 5}
TOP_TIERS = ("VIP", "3U")  # always a best play


def rank_key(p):
    """Bigger plays first (VIP, 3U, 2U, 1U); expected value only breaks ties within a size."""
    return (TIER_RANK.get(p.get("tier"), 9), -(p.get("ev") or 0))
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
    lh, lm = (int(x) for x in settings.get("lock_time_et", "10:30").split(":"))
    if not backfill and (now.hour, now.minute) < (lh, lm):
        return []
    open_slots = settings["picks_per_day"] - len(todays)
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
    cands.sort(key=rank_key)
    picked = []
    # a 3U/VIP that shows up after the lock bumps the weakest pick whose game hasn't started
    if not backfill:
        for p in [c for c in cands if c.get("tier") in TOP_TIERS]:
            if open_slots > 0:
                break
            bumpable = [e for e in todays if e.get("tier") not in TOP_TIERS and e["status"] == "pending"
                        and (parse_start(e.get("start")) or now) > now + timedelta(minutes=5)]
            if not bumpable:
                break
            weakest = max(bumpable, key=rank_key)
            ledger.remove(weakest)
            todays.remove(weakest)
            taken_games.discard((weakest["sport"], weakest["event"],
                                 weakest.get("player") if weakest["market"] == "prop" else None))
            open_slots += 1
            print(f"Bumped {weakest['selection']} for a new {p['tier']} play")
    if open_slots <= 0:
        return []
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


def set_play_of_the_day(ledger, now):
    """The day's single best play: the top-ranked pick. Once its game starts it's final;
    before that, a better pick (e.g. a 3U posted after the lock) can take its place."""
    days = {}
    for e in ledger:
        days.setdefault(e["date"], []).append(e)
    for es in days.values():
        cur = next((e for e in es if e.get("potd")), None)
        started = cur is not None and (cur["status"] != "pending" or
                                       (parse_start(cur.get("start")) or now) <= now)
        if started:
            continue
        best = min(es, key=rank_key)
        for e in es:
            e["potd"] = e is best


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


ESPN_LOGOS = {"NBA": "nba", "NHL": "nhl", "NFL": "nfl"}  # ESPN logo paths go by team code


def team_index():
    """Team short name -> code, logo and color per sport, for logos on the page."""
    out = {}
    for folder, code, _ in SPORTS:
        teams = out.setdefault(code, {})
        try:
            with open(os.path.join(ROOT, folder, "games.json")) as f:
                for g in json.load(f).get("games", []):
                    for t in (g["away"], g["home"]):
                        a = t.get("abbr")
                        if a and t.get("short"):
                            teams[t["short"]] = {"a": a, "l": f"https://a.espncdn.com/i/teamlogos/{ESPN_LOGOS[code]}/500/{a.lower()}.png"
                                                 if code in ESPN_LOGOS else None}
        except (OSError, ValueError, KeyError):
            pass
    try:  # NFL has no games.json; its predictions.json lists every team with logo and color
        with open(os.path.join(ROOT, "nfl", "predictions.json")) as f:
            for a, t in json.load(f).get("teams", {}).items():
                out["NFL"][t.get("nick") or a] = {"a": a, "l": t.get("logo"), "c": t.get("color")}
    except (OSError, ValueError, KeyError):
        pass
    return out


# what the hub shows of your own picks (from the private my-picks repo): no notes, no model numbers
MINE_FIELDS = ("id", "kind", "sport", "date", "start", "market", "side", "selection", "units", "price",
               "status", "result_units", "final", "home_short", "away_short", "confidence", "feed_id")


def load_my_picks(path, now):
    """Your picks from picks.json, trimmed to what the hub page needs. None if not available."""
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    abbr = {}  # team code per (sport, date, home team), for logos
    for folder, code, _ in SPORTS:
        try:
            with open(os.path.join(ROOT, folder, "games.json")) as f:
                for g in json.load(f).get("games", []):
                    abbr[(code, g.get("date"), g["home"]["name"])] = (g["away"].get("abbr"), g["home"].get("abbr"))
        except (OSError, ValueError, KeyError):
            pass
    out = []
    for p in d.get("picks", []):
        e = {k: p.get(k) for k in MINE_FIELDS if p.get(k) is not None}
        a = abbr.get((p.get("sport"), p.get("date"), p.get("home")))
        if a:
            e["away_abbr"], e["home_abbr"] = a
        out.append(e)
    return {"picks": out, "read_at": now.strftime("%Y-%m-%dT%H:%M")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--now", help="ET time to pretend it is (testing)")
    ap.add_argument("--backfill", metavar="YYYY-MM-DD",
                    help="fill past days from this date through yesterday (days with no picks)")
    ap.add_argument("--my-picks", metavar="PICKS_JSON", default=os.environ.get("MY_PICKS_JSON"),
                    help="your picks.json from the private my-picks repo (optional)")
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
    ledger.sort(key=lambda e: (e["date"], rank_key(e)))
    day_n = {}
    for e in ledger:
        day_n[e["date"]] = day_n.get(e["date"], 0) + 1
        e["slot"] = day_n[e["date"]]
    set_play_of_the_day(ledger, now)
    with open(LEDGER, "w") as f:
        json.dump(ledger, f, indent=1)
    try:  # phone alerts must never break the hub build
        import alerts
        alerts.run(ledger, by_id, now, settings, parse_start)
    except Exception as e:
        print(f"Alerts skipped: {e}")

    payload = {"generated_at": now.strftime("%Y-%m-%dT%H:%M"), "today": day,
               "settings": settings, "ledger": ledger, "sports": sport_records(feeds),
               "folders": {code: f["folder"] for code, f in feeds.items()},
               "names": {code: f["name"] for code, f in feeds.items()},
               "mine": load_my_picks(args.my_picks, now), "teams": team_index()}
    with open(os.path.join(HUB, "teams.json"), "w") as f:  # team logos for the Share page
        json.dump(payload["teams"], f)
    with open(os.path.join(HUB, "template.html")) as f:
        page = f.read().replace("/*HUB*/null", json.dumps(payload))
    with open(os.path.join(ROOT, "index.html"), "w") as f:
        f.write(page)
    graded = [e for e in ledger if e["status"] in FINAL]
    print(f"Hub: {len(ledger)} official plays ({len(new)} new today, {len(graded)} graded); "
          f"feeds: " + ", ".join(f"{c} {len(f['plays'])}" for c, f in feeds.items()) +
          (f"; my picks: {len(payload['mine']['picks'])}" if payload["mine"] else "; my picks: not available"))


if __name__ == "__main__":
    main()
