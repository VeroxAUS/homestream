import { describe, expect, it } from 'vitest';
import { main } from '../../../../scripts/droid-pr-cleanup.mjs';
import { pruneMarkedComments } from '../../../../scripts/lib/github.mjs';

const MARKER = '<!-- factory-pr-issue-comment: run-type=droid-review -->';

interface Comment {
  id: number;
  body: string;
  user: { type: string };
}

function fakeIssue(comments: Comment[]) {
  const deleted: number[] = [];
  return {
    deleted,
    async paginate(route: string) {
      expect(route).toBe('{repo}/issues/7/comments');
      return comments.filter((comment) => !deleted.includes(comment.id));
    },
    async request(method: string, route: string) {
      expect(method).toBe('DELETE');
      deleted.push(Number(route.split('/').at(-1)));
      return {};
    },
  };
}

const bot = (id: number, body: string): Comment => ({ id, body, user: { type: 'Bot' } });

describe('pruneMarkedComments', () => {
  it('keeps only the newest bot comment with the marker and leaves other comments alone', async () => {
    const github = fakeIssue([
      bot(1, `first ${MARKER}`),
      bot(2, '<!-- homestream-ci-timing --> timing'),
      { id: 3, body: `quoted by a person ${MARKER}`, user: { type: 'User' } },
      bot(4, `second ${MARKER}`),
      bot(5, `third ${MARKER}`),
    ]);
    expect(await pruneMarkedComments(github, 7, MARKER)).toEqual([1, 4]);
    expect(github.deleted).toEqual([1, 4]);
  });

  it('does nothing when there is at most one marked comment', async () => {
    const github = fakeIssue([bot(1, `only ${MARKER}`), bot(2, 'unrelated')]);
    expect(await pruneMarkedComments(github, 7, MARKER)).toEqual([]);
    expect(github.deleted).toEqual([]);
  });
});

describe('droid-pr-cleanup main', () => {
  it('prunes the comments of the pull request named in PR_NUMBER and exits 0', async () => {
    const github = fakeIssue([bot(10, `a ${MARKER}`), bot(11, `b ${MARKER}`)]);
    expect(await main({ PR_NUMBER: '7' }, { github })).toBe(0);
    expect(github.deleted).toEqual([10]);
  });

  it('skips without a pull request number', async () => {
    const github = fakeIssue([bot(10, `a ${MARKER}`), bot(11, `b ${MARKER}`)]);
    expect(await main({}, { github })).toBe(0);
    expect(await main({ PR_NUMBER: 'abc' }, { github })).toBe(0);
    expect(github.deleted).toEqual([]);
  });
});
