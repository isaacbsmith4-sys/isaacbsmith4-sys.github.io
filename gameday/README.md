# GAME DAY

All-sports command center at https://isaacbsmith4-sys.github.io/gameday/ (NBA, NFL, NCAAB, CFB).
Static app, no build step, no server. Favorites and settings live on the device (localStorage).

| File | What it does |
|---|---|
| `js/core.js` | Saved state (favorites, home layout, sports), fetch + source log, date helpers |
| `js/data.js` | `SPORTS` config, ESPN scoreboards/news/search/athletes/schedules/standings, and one **model adapter per sport** that turns each model's published file into one shape |
| `js/ui.js` | Shared components (game card, badges, logos) |
| `js/app.js` | Router, views (Home, Scores, Teams, Stats, Profile, team, player, search), auto-refresh |
| `js/gamecenter.js` | Game Center (`#/game/<sport>/<id>`): line score, your model vs the book, ESPN win probability, game flow / scoring plays, box score, team stats, plays or drives, head-to-head (home team's last 4 seasons) and recent form |
| `js/players.js` | Player profiles (`#/player/<sport>/<id>`): Player performance card (season / L5 / L10 vs your model's projection and the prop line), trend chart, averages and splits, game log, career; plus per-game projection tables (Game Center) and Home > My players |
| `js/teams.js` | Team profiles (`#/team/<sport>/<id>`): next-game prediction (projected score from the model's spread + total, margin, win %, model vs book), the model's matchup inputs (NFL: factor breakdown, Elo/EPA ranks), recent form, team stats with league scoring ranks (from standings), model ratings, division/conference table, schedule, roster |
| `js/stats.js` | Stats tab: Stats Lab (sortable league tables + chart; NBA/NFL efficiency from `../research/data/*_teamstats.json`, college = your models' ratings), Rankings (AP/coaches, model power rankings, SOS, playoff picture), Matchup Analyzer (`#/stats/matchup/<sport>/<a>/<b>`) |
| `js/news.js` | News (`#/news/headlines|injuries|moves`): league + followed-team headlines, NBA/NFL injury reports (ESPN keeps none for college), transactions |
| `js/calendar.js` | Calendar (`#/calendar/day|week|month`): game dots per sport, your teams' games, season phases and postseason rounds, `.ics` reminders |
| `js/alerts.js` | Notification center (`#/alerts`, bell badge): soon/live/final for your teams, big games by your players, injury-report changes, tagged news, model-vs-line gaps; optional pop-up alerts while the app is open |
| `data/teams.json` | Team list, built by `tools/build_teams.py` (ESPN's teams endpoint blocks browsers). Rerun each season. |

## Sources (kept separate in the UI)
- **Actual**: ESPN public APIs, fetched from the phone (they allow cross-origin requests).
- **Model**: the files the models already publish here: `../nba|ncaab|cfb/games.json`, `../nfl/predictions.json`.
  Spreads are normalized to home perspective, negative = home favored. NFL file is home margin, so it's negated.
- **Player projections**: NBA from `../research/data/nba_props.json` (the NBA model's prop board; only players with a posted line),
  NFL from `../nfl/props.json` (every skill player; matched to ESPN by name + team). College models have no player projections.
- **Market**: the line inside each model file (DraftKings via ESPN; NFL uses nflverse consensus) or ESPN's odds.

## Updating
Bump `?v=N` on every module import, `index.html` and `sw.js` (SHELL + CACHE) together, or phones keep old code.
Publish: `git pull --rebase --autostash`, `git add gameday`, commit, push.

## Not built yet
News/injuries page,
calendar, notifications, odds center, AI assistant (see the phase plan).
