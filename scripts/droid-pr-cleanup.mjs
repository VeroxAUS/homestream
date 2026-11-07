import { githubClient, pruneMarkedComments, redactValues } from './lib/github.mjs';
import { isMain } from './lib/util.mjs';

/**
 * Leaves one Droid summary comment on a pull request. Factory's action adds a new "Droid finished" comment on every
 * push; this keeps the newest and deletes the earlier ones (run by .github/workflows/droid-review.yml after the review).
 * Needs GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER. Always exits 0: a failed cleanup must not fail the pull request.
 */

const DROID_COMMENT_MARKER = '<!-- factory-pr-issue-comment: run-type=droid-review -->';

export async function main(env = process.env, { github = null } = {}) {
  const number = Number(env.PR_NUMBER);
  if (!Number.isInteger(number) || number <= 0) {
    console.log('::notice title=Droid comment cleanup skipped::No pull request number in this run.');
    return 0;
  }
  const client = github ?? githubClient({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY });
  const removed = await pruneMarkedComments(client, number, DROID_COMMENT_MARKER);
  console.log(`Removed ${removed.length} earlier Droid summary comment(s) from #${number}.`);
  return 0;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.log(
        `::warning title=Droid comment cleanup failed::${redactValues(error.message, [process.env.GITHUB_TOKEN])}`,
      );
      process.exit(0);
    },
  );
}
