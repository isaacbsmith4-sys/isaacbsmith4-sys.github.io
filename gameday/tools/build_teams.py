"""Build gameday/data/teams.json from ESPN (its teams endpoint has no CORS, so the app can't
fetch it in the browser). Teams rarely change; rerun at the start of a season.
    python3 gameday/tools/build_teams.py
"""
import json, os, urllib.request
from datetime import datetime, timezone

SPORTS = {
    "nba":   ("basketball/nba", ""),
    "nfl":   ("football/nfl", ""),
    "ncaab": ("basketball/mens-college-basketball", ""),
    "cfb":   ("football/college-football", ""),   # kept to FBS below (teams in FBS standings)
}
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "teams.json")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def groups(path):
    """team id -> (conference, division) from the standings tree."""
    out = {}
    def walk(node, conf=None):
        name = node.get("abbreviation") or node.get("name")
        for e in node.get("standings", {}).get("entries", []):
            out[e["team"]["id"]] = (conf or node.get("name"), node.get("name") if conf else None)
        for c in node.get("children", []):
            walk(c, conf or node.get("name"))
    try:
        d = get(f"https://site.web.api.espn.com/apis/v2/sports/{path}/standings?level=3")
        for c in d.get("children", []):
            walk(c)
    except Exception as ex:
        print("standings failed", path, ex)
    return out


def main():
    data = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "source": "ESPN teams + standings", "sports": {}}
    for key, (path, extra) in SPORTS.items():
        d = get(f"https://site.api.espn.com/apis/site/v2/sports/{path}/teams?limit=1000{extra}")
        g = groups(path)
        teams = []
        for t in d["sports"][0]["leagues"][0]["teams"]:
            t = t["team"]
            if not t.get("isActive", True):
                continue
            logo = next((l["href"] for l in t.get("logos", []) if "dark" in l.get("rel", [])), None) \
                or (t.get("logos") or [{}])[0].get("href")
            conf, div = g.get(t["id"], (None, None))
            teams.append({
                "id": t["id"], "name": t["displayName"], "short": t.get("shortDisplayName") or t.get("name"),
                "nick": t.get("name"), "abbr": t.get("abbreviation"), "logo": logo,
                "color": "#" + (t.get("color") or "666666"), "alt": "#" + (t.get("alternateColor") or "999999"),
                "conf": conf, "div": div,
            })
        if key == "cfb":
            teams = [t for t in teams if t["conf"]]
        teams.sort(key=lambda x: x["name"])
        data["sports"][key] = teams
        print(key, len(teams), sum(1 for t in teams if t["conf"]), "with conference")
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
