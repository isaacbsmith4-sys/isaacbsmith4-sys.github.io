# LIFE HQ kit

Shared code for the life apps on this site. Mirrors how the sports apps work: each app is its
own page with its own home-screen icon, and one central app (LIFE HQ, `/hq/`) pulls them all
together into Today and a Calendar.

| Piece | What it is |
|---|---|
| `kit/kit.js` | Sync layer every life app loads. Saves to the private repo `isaacbsmith4-sys/life-data` through the GitHub API, keeps a local copy so apps work offline, merges edits from different devices per record. Also the shared "Synced" pill and Connect sheet. |
| `kit/apps.js` | The app list (names, colors, roadmap phase) and one adapter per built app that turns that app's files into Today numbers and calendar events. Only LIFE HQ loads it. |
| `hq/` | LIFE HQ: Today, Calendar, Apps, Setup. |
| `sleep/`, `fuel/` | Apps. Each registers its files with `Life.col(...)` / `Life.doc(...)`, calls `replace`/`set` when it saves, and re-reads on `Life.onChange`. |
| `kit/dev/mock_github.py` | Local stand-in for the GitHub contents API, for testing sync (`life-mock` in nba-model's `.claude/launch.json`; set `localStorage['life:api']='http://localhost:8942'`, only honored on localhost, token `test-token`). |

**Data never lands in this public repo.** It goes only to life-data. See `life-data/FORMAT.md`
for the file layout and record rules.

## Connecting a device
Each app asks once for a fine-grained GitHub token limited to life-data with Contents: Read and
write. On iPhone every home-screen app has its own storage, so the key is pasted once per app
(LIFE HQ › Setup › Copy key). In Safari, all apps on this site share one key.

## Adding an app
1. Folder `<app>/` with `index.html`, `manifest.webmanifest`, `sw.js` (cache `../kit/kit.js`), `make_icon.py`.
2. Load `../kit/kit.js`; keep records under `<app>/...` in life-data; call `Life.start()`.
3. Mark it `built: true` in `kit/apps.js` and add an adapter (`has`, `today`, `events`, `load`).
4. Publish: `git pull --rebase --autostash`, `git add` only the app's folder (+ kit), commit, push.

## Not built yet (roadmap)
Phase 2: Train, Habits. Phase 3: School, Focus, Mindset. Phase 4: Recovery, Basketball, Finance.
Phase 5: AI daily briefing and weekly report (GitHub Actions in life-data with an Anthropic API
key secret), cross-app analytics, ntfy reminders. Phase 6: polish, security and sync testing.
