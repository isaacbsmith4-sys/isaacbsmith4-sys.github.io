# games.json: every game's data, for the hub's Data tab

Each sport app publishes `<sport>/games.json` next to `plays.json`. It has **every game**
(not just plays) from yesterday through the next few days, with the raw numbers someone
would want for their own handicapping. No tiers or picks in this file.

```json
{
  "sport": "NBA",
  "format": 1,
  "generated_at": "2026-10-20T14:00Z",
  "games": [
    {
      "id": "nba-401909088",
      "date": "2026-10-20",               // US Eastern date
      "start": "2026-10-20T23:00Z",       // UTC ISO, or null
      "status": "pre",                     // "pre" | "in" | "post"
      "status_text": "7:00 PM",            // optional, e.g. "Final", "Q3 4:12"
      "neutral": false,
      "away": {
        "name": "Boston Celtics", "short": "Celtics", "abbr": "BOS",
        "record": "0-0",                   // optional
        "score": null,                     // final/live score, else null
        "rest_days": 4,                    // optional, null if unknown
        "b2b": false,                      // optional
        "injuries": [{"name": "Jrue Holiday", "status": "Out"}],
        "stats": {"Team rating (pts vs avg)": 3.1, "Last 10 avg margin": 1.4}
      },
      "home": { "...": "same fields" },
      "lines": {                           // home-team perspective for spreads; null when missing
        "book": "DraftKings",
        "spread": -1.5, "spread_open": -2.5,
        "total": 221.5, "total_open": 220.0,
        "home_ml": -125, "away_ml": 105, "home_ml_open": -130, "away_ml_open": 110
      },
      "model": {                           // the model's numbers, shown as data, never as a pick
        "spread": -2.2,                    // home perspective: negative = home favored
        "total": null,
        "home_win_prob": 0.57
      },
      "notes": ["Early season: model line is partly the market's view"]
    }
  ]
}
```

- `stats` is free-form: label -> number (or short text). The Data tab shows a side-by-side
  table of the labels both teams have, so use the same labels for both sides.
- Sports with a puck line / run line put it in `spread` (e.g. -1.5).
- Keep `injuries` to the players that matter (rotation players / starters), most important first.
- Serve it with the same no-cache headers as `plays.json` (GitHub Pages does this already).
