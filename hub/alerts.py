"""Phone alerts through ntfy (free app, no account): the ntfy app subscribes to a private
channel name, stored as the NTFY_TOPIC secret; the hub's cloud run posts to it.

Sends, each at most once (remembered in hub/alerts_state.json):
  - lock:    the day's Play of the Day and card once they lock (and any later additions)
  - recap:   yesterday's results each morning
  - drop:    the model no longer lists a locked play (or dropped it below 1U)
  - move:    the line moved 1+ point against a locked play before its game
Set ALERTS_DRY=1 to print instead of sending.
"""
import json
import os
import urllib.request
from datetime import timedelta

HUB = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HUB, "alerts_state.json")
SITE = "https://isaacbsmith4-sys.github.io/"
FINAL = ("win", "loss", "push", "void")


def send(title, message, tags=(), priority=3):
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if os.environ.get("ALERTS_DRY") or not topic:
        print(f"[alert{' (dry run)' if topic else ' (no NTFY_TOPIC)'}] {title} | {message}")
        return True
    body = json.dumps({"topic": topic, "title": title, "message": message, "tags": list(tags),
                       "priority": priority, "click": SITE}).encode()
    req = urllib.request.Request("https://ntfy.sh/", data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print(f"Alert failed: {e}")
        return False


def _units_txt(u):
    return f"{'+' if u > 0 else ''}{u:.1f}u"


def _line_delta(entry, play):
    """Points of line movement from your side's view: negative = moved against you."""
    old, new = entry.get("line"), play.get("line")
    if old is None or new is None:
        return 0.0
    sel = (entry.get("selection") or "").lower()
    if entry.get("market") == "spread":
        return float(new) - float(old)
    if " over " in f" {sel} " or sel.startswith("over"):
        return float(old) - float(new)
    if " under " in f" {sel} " or sel.startswith("under"):
        return float(new) - float(old)
    return 0.0


def run(ledger, by_id, now, settings, parse_start):
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    sent = state.setdefault("sent", {})
    day = now.date().isoformat()
    yday = (now.date() - timedelta(days=1)).isoformat()

    # 1. today's card, once it's locked (later additions get their own alert)
    todays = sorted([e for e in ledger if e["date"] == day], key=lambda e: e.get("slot", 9))
    fresh = [e for e in todays if f"lock:{e['id']}" not in sent]
    if fresh:
        potd = next((e for e in fresh if e.get("potd")), None)
        lines = [f"{'★ ' if e.get('potd') else '• '}{e['selection']} ({e['sport']}, {e.get('stake', 1):g}U)" for e in fresh]
        first = not any(k.startswith("lock:") and k.split(":", 1)[1] in {e["id"] for e in todays} for k in sent)
        title = f"★ Play of the Day: {potd['selection']}" if (first and potd) else "Added to today's card"
        if send(title, "\n".join(lines), tags=("star",), priority=4):
            for e in fresh:
                sent[f"lock:{e['id']}"] = now.isoformat()

    # 2. yesterday's results, once everything's graded (or by 11 AM regardless)
    yes = [e for e in ledger if e["date"] == yday]
    if yes and f"recap:{yday}" not in sent and now.hour >= 8:
        done = [e for e in yes if e["status"] in FINAL]
        if len(done) == len(yes) or now.hour >= 11:
            w = sum(e["status"] == "win" for e in done)
            l = sum(e["status"] == "loss" for e in done)
            u = sum(e.get("result_units") or 0 for e in done)
            potd = next((e for e in yes if e.get("potd")), None)
            lines = [f"{'★ ' if e.get('potd') else ''}{e['selection']}: {e['status'].upper()}"
                     + (f" {_units_txt(e['result_units'])}" if e.get("result_units") is not None else "") for e in yes]
            if len(done) < len(yes):
                lines.append(f"{len(yes) - len(done)} still waiting on results")
            title = f"Yesterday: {w}-{l}, {_units_txt(u)}" + (f" · ★ {potd['status'].upper()}" if potd and potd["status"] in FINAL else "")
            if send(title, "\n".join(lines), tags=("chart_with_upwards_trend" if u >= 0 else "chart_with_downwards_trend",)):
                sent[f"recap:{yday}"] = now.isoformat()

    # 3. heads-up on locked plays that haven't started
    allowed = set(settings.get("allowed_tiers", []))
    for e in todays:
        if e["status"] != "pending":
            continue
        start = parse_start(e.get("start"))
        if start is not None and start <= now:
            continue
        p = by_id.get(e["id"])
        if (p is None or p.get("tier") not in allowed) and f"drop:{e['id']}" not in sent:
            why = "no longer lists it" if p is None else f"now has it as {p.get('tier') or 'no play'}"
            if send(f"Heads up: {e['selection']}", f"The {e['sport']} model {why}. It stays on today's card; your call.", tags=("warning",), priority=4):
                sent[f"drop:{e['id']}"] = now.isoformat()
            continue
        if p is not None and f"move:{e['id']}" not in sent:
            d = _line_delta(e, p)
            if d <= -1.0:
                if send(f"Line moved: {e['selection']}", f"Now {p.get('selection')} ({abs(d):g} pts against you since it locked).", tags=("chart_with_downwards_trend",), priority=4):
                    sent[f"move:{e['id']}"] = now.isoformat()

    # keep the state file small: drop entries older than two weeks
    cutoff = (now - timedelta(days=14)).isoformat()
    state["sent"] = {k: v for k, v in sent.items() if v >= cutoff}
    with open(STATE, "w") as f:
        json.dump(state, f, indent=1)
