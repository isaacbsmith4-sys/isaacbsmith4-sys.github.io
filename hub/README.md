# Best Plays hub

The page at https://isaacbsmith4-sys.github.io/ (this repo's `index.html`, generated, so
don't edit it by hand). Each sport publishes its own app to a subfolder (`nba/`, `nfl/`,
`nhl/`, `ncaab/`, `cfb/`) from its private repo, including `<sport>/plays.json`.

- `hub/build.py` reads every sport's `plays.json`, locks the day's best plays at the lock
  hour, grades them as each sport reports results, and writes `index.html` from
  `hub/template.html`. Standard library only.
- `hub/ledger.json`: the official best plays and their results (the hub's record). The top-ranked
  pick each day is marked `potd` (Play of the Day) and tracked as its own record; it stays
  final once its game starts.
- `hub/settings.json`: plays per day (3), lock time (10:30 AM ET), allowed tiers (1U and up).
- `.github/workflows/hub.yml`: runs every 30 minutes from 9 AM to 1 AM ET.

Ranking: every 3U/VIP play first (one arriving after the lock bumps the weakest unstarted pick),
then the highest expected profit per unit (`ev`) among 1U/2U. Leans never. One bet per game
on game lines; props on different players can share a game.
To add a sport: add it to `SPORTS` in `hub/build.py` and a color token in the template.

Phone alerts: `hub/alerts.py` posts to ntfy (free app, no account) on the private channel in
the NTFY_TOPIC secret: the day's card when it locks (Play of the Day first), yesterday's
results each morning, and a heads-up if the model drops a locked play or its line moves 1+
point against it. Each alert is sent once (remembered in `hub/alerts_state.json`).
