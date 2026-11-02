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
| `js/odds.js` | Odds Center (`#/odds/lines|plays|records`): DraftKings open → latest via ESPN, no-vig %, your models' numbers and gaps, your models' open plays and graded records (from each `plays.json`), NFL ATS computed from nflverse scores + the NFL model's lines |
| `js/assistant.js` | Ask GAME DAY (`#/ask`): built-in assistant, no AI key; answers set question types from app data with sources |
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

## Performance and offline (sw.js)
- App files have versioned URLs and are served cache-first. Everything else (your models' files, ESPN) is network-first,
  so it's always current; same-origin files fall back to the cached copy offline. (A stale-while-revalidate cache for the
  model files was tried and reverted: it made those requests slower in testing.)
- Home paints once the sports that answer within 2.5 s are in, then fills in late sports, news, player projections and alerts.
- Injury alerts use team rosters (small), not ESPN's league injury report (the NFL one is ~8 MB).

## Checks done in phase 9
Every page at 375 px and 320 px (no overflow, no script errors), detail pages for all four sports, model sign conventions
(spread vs win chance, book spread vs moneylines), projections equal to the source files, NFL name matching (268/271 exact;
the rest by unique last name), league efficiency sums (ORtg = DRtg, offense EPA = defense EPA).

## Known limits
- No player projections for college (the NCAAB/CFB models predict games only); NBA projections only for players with posted prop lines.
- Odds: DraftKings via ESPN (open and latest), not live in-play; FanDuel isn't connected. Team ATS only for the NFL.
- KenPom isn't connected; college strength of schedule isn't in the models' files.
- Alerts pop up only while the app is open (no push server). The assistant is built in (no AI key); free-form chat would need
  an Anthropic key plus a small proxy.
