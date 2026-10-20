# Best Plays hub

The page at https://isaacbsmith4-sys.github.io/ (this repo's `index.html`, generated, so
don't edit it by hand). Each sport publishes its own app to a subfolder (`nba/`, `nfl/`,
`nhl/`, `ncaab/`, `cfb/`) from its private repo, including `<sport>/plays.json`.

- `hub/build.py` reads every sport's `plays.json`, locks the day's best plays at the lock
  hour, grades them as each sport reports results, and writes `index.html` from
  `hub/template.html`. Standard library only.
- `hub/ledger.json`: the official best plays and their results (the hub's record).
- `hub/settings.json`: plays per day (3), lock hour (11 AM ET), allowed tiers (1U and up).
- `.github/workflows/hub.yml`: runs every 30 minutes from 9 AM to 1 AM ET.

Ranking: biggest bets first (3U/VIP, then 2U, then 1U; leans never), then expected profit
per unit (`ev`). One bet per game on game lines; props on different players can share a game.
To add a sport: add it to `SPORTS` in `hub/build.py` and a color token in the template.
