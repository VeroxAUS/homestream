# Runbook: flaky tests

A flaky test passes and fails on the same code. In CI mode (`CI=true`) vitest retries a failing test twice, so a flaky test shows up as a test that passed on a retry. The retry keeps the build green but the test is still broken: find it and fix it.

## Symptoms

- A CI run is green but its summary says a test needed retries.
- A test fails on your machine and passes when you run it again, or fails only when the whole suite runs.
- `pnpm test:flaky-report` lists tests.

## Diagnosis

1. Produce the reports the way CI does, then read the flaky list and the slowest tests:

   ```powershell
   $env:CI = 'true'; pnpm test:report
   pnpm test:flaky-report
   pnpm test:timing
   ```

   Reports go to `reports/<package>/` (`junit.xml`, `vitest.json`, `flaky.json`). In bash use `CI=true pnpm test:report`. Do not run this while a game or a heavy encode is running, timing tests are sensitive to load.

2. Run the one test file repeatedly, alone and with the unit project:

   ```powershell
   pnpm --filter @homestream/server exec vitest run --project unit test/net.test.ts
   ```

   Repeat it ten times. If it only fails together with other files, it shares state: a port, a temp directory, an environment variable, a global timer or a module-level singleton.

3. Look for the usual causes:
   - **Hard-coded port or path.** Tests must use `PORT=0` and `makeTempDir()` from `apps/server/test/helpers.ts`.
   - **Real time.** Use vitest fake timers or an injected clock instead of `sleep`.
   - **Unawaited work.** A request or file write that is still running when the test ends.
   - **Order dependence.** Tests that rely on another test's data.
   - **CPU load.** A timing assertion that is too tight for a busy machine. Assert on behaviour, not milliseconds, or widen the margin.

## Fix

- Fix the cause in the test (or the code, if the test found a real race). Do not raise the retry count or add a skip.
- If you cannot fix it now, record it in [docs/TECH_DEBT.md](../TECH_DEBT.md) with the file and the symptom, and tell the owner. A skipped test with no record is not allowed.
- Never "fix" a flaky test by deleting the assertion that fails.

## Verify

Run the file ten times in a row with no failure, then the whole tier:

```powershell
pnpm test:ci
```

After a CI run, `pnpm test:flaky-report` no longer lists the test.
