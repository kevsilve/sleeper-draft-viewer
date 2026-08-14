# Sleeper Draft Viewer

An installable, party-ready live presentation for Sleeper fantasy football drafts.

The app runs entirely in the browser. While a draft is open it polls Sleeper's public API every 500 ms for picks, reconciles the complete history after interruptions, and keeps the presentation logic local to the display. No account, database, WebSocket server, or environment variables are required.

## Local development

Requirements: Node.js 24 and npm.

```powershell
npm install
npm run dev
```

Open the displayed local URL, search by Sleeper username, or paste a Sleeper draft link. A selected draft is stored locally and represented by `/?draft=<draft_id>` so it can be bookmarked.

## Verification

```powershell
npm test
npm run build
npm run test:e2e
```

The end-to-end suite mocks Sleeper responses and verifies initial connection, polling, reveal deduplication, and invalid-draft handling.

## Deployment

Import this repository into Vercel as a Vite project. Use `npm run build` and the `dist` output directory. The project has no required environment variables. Pushes to feature branches receive preview URLs; `main` is production.

The generated `vercel.app` URL is intentionally public but unlisted. Usernames, draft selections, cached player data, and presentation preferences remain in the browser.

## Operational behavior

- Picks: 500 ms polling while the page is open.
- Draft metadata: 1 second polling.
- Traded picks: 5 second polling.
- Player catalog: IndexedDB cache refreshed no more than once every 24 hours.
- Recovery: exponential retry up to 5 seconds plus immediate authoritative reconciliation when the page becomes visible or the UI detects stale state.
- ADP: best-effort Sleeper research data; reach/value labels quietly disable if it is unavailable.

If Sleeper ever removes cross-origin browser access, add a narrowly allowlisted Vercel GET proxy and keep the browser-owned draft engine unchanged.
