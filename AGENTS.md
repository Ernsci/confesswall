# ConfessWall

Express + Supabase confession wall with an admin panel (/adin), public wall (/wall), and creator page (/creator).

## Deploy & Monitor workflow

Run this after EVERY commit + push to `main` (Render auto-deploys):

1. **Read the Render API token** from `C:\Users\Eren\.config\opencode\.env`
   (`RENDER_API_KEY`). Never print it or commit it anywhere.
2. **Poll deploy status** until finished:
   `GET https://api.render.com/v1/services/srv-da55i2rm8hqs73bgsns0/deploys?limit=1`
   - `live` → healthy, continue to logs
   - `build_failed` / `pre_deploy_failed` / `deactivated` → bug: read build logs via
     `GET .../deploys/{deployId}/logs`, fix, push again
3. **Fetch runtime logs**:
   `GET https://api.render.com/v1/logs?ownerId=tea-d288o4s9c44c73a6t9s0&limit=100`
   (free tier may return empty shortly after boot — wait ~30s, retry once)
4. **Grep the log lines** for trouble patterns:
   `/discord|ntfy|error|warn|missing|Rate cap|Blocked|running on port/i`
5. **Report**: if errors → fix root cause, push, repeat steps 2–4.
   If clean → tell the user deployment is healthy with a short summary.

## Rules

- Never echo secret values (RENDER_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_PASSWORD, DISCORD_WEBHOOK_URL) into chat output — mask them.
- Service id: `srv-da55i2rm8hqs73bgsns0` · Owner id: `tea-d288o4s9c44c73a6t9s0`
- Production config lives in Render env vars, not in any committed file.
