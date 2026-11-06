# Runbook: rollback

Use this when a change broke the server (or the build) and you want the last good version back quickly. History on `main` is never rewritten, so a rollback is a new commit that undoes the bad one (`git revert`), or a temporary checkout of an older commit.

## Symptoms

- The server fails to start, or `GET /api/health` shows new errors right after an update.
- Playback regressed after a specific commit.
- CI on `main` is red because of the last merge.

## Diagnosis

1. Find the last known good commit:

   ```powershell
   git log --oneline -20
   git status --short
   ```

   `git status` must show no uncommitted work you care about. Commit or stash it first, a checkout can overwrite it.

2. Confirm the commit is the cause. Check out the commit before it in a separate worktree, so your current checkout stays untouched:

   ```powershell
   git worktree add ../homestream-good <good-sha>
   ```

   Then in that folder run `node scripts/bootstrap.mjs`, copy your `.env` over, and start the server on the usual port after stopping the broken one. If it works there, the later commit is the cause. Remove the worktree when done: `git worktree remove ../homestream-good`.

## Fix

**Undo one commit and keep history (preferred):**

```powershell
git revert <bad-sha>
pnpm install --frozen-lockfile
pnpm build
pnpm test:ci
```

The revert is a normal commit. Push it with the usual Conventional Commit style message (`revert: ...`) and the `Co-authored-by` trailer when an AI agent wrote it. Never force-push and never reset published history.

**Run an older version for now, without changing `main`:** use the worktree above, or `git switch --detach <good-sha>`, then `pnpm install --frozen-lockfile` and `pnpm build`. Switch back with `git switch main`.

**Database:** migrations only go forward and each one is additive. An older server ignores tables and columns it does not know, but back up the file before you roll back across a migration. Stop the server first, then copy `homestream.db` from `DATA_DIR`:

```powershell
Copy-Item (Join-Path $env:DATA_DIR 'homestream.db') (Join-Path $env:DATA_DIR 'homestream.db.bak')
```

(Use the real `DATA_DIR` from your `.env` if the variable is not set in your shell.) To see which schema version the code expects, read the first lines of [docs/schema.sql](../schema.sql).

**Configuration:** a rollback never touches `.env`. If the bad version needed a new setting, the old one ignores it.

Restart the server after switching code. Stop it by process id or with Ctrl+C, never by name.

## Verify

```powershell
curl.exe http://localhost:8600/api/health
curl.exe http://localhost:8600/api/info
pnpm test:ci
```

`/api/info` reports the server version you are running. All health checks that were green before the bad change are green again, and a title starts and plays.
