import { describe, expect, it } from 'vitest';
import {
  DownloadGate,
  HIGH_LEAD_SEC,
  LOW_LEAD_MEMORY_MS,
  LOW_LEAD_SEC,
  RANK_ENCODER,
  RANK_EXTRACTOR,
  pickNext,
  type Priority,
} from '../../src/network/downloadGate.js';
import { mbpsToBytesPerSec } from '../../src/network/limits.js';
import { FakeClock } from './fakeClock.js';

const CHUNK = 65_536;
const WINDOW_SEC = 180;

/** An encoder reading as fast as the gate allows, with a player draining its lead in real time. */
class Session {
  lead: number;
  bytes = 0;
  stalls = 0;
  private stalled = false;
  private lastTick = 0;

  constructor(
    readonly needMbps: number,
    initialLead: number,
    readonly paced = false,
    /** Time between a grant and the reader's next request: reading the next chunk from the socket and handing the last one on. */
    readonly gapMs = 0,
  ) {
    this.lead = initialLead;
  }

  priority = (): Priority => ({ rank: RANK_ENCODER, lead: this.lead });

  /** Seconds of video one downloaded chunk adds to the lead. */
  get secPerByte(): number {
    return 8 / (this.needMbps * 1_000_000);
  }

  tick(now: number): void {
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.lead -= dt;
    if (this.lead <= 0) {
      this.lead = 0;
      if (!this.stalled) this.stalls += 1;
      this.stalled = true;
    } else if (this.lead > 1) {
      this.stalled = false;
    }
  }

  credit(bytes: number): void {
    this.bytes += bytes;
    this.lead += bytes * this.secPerByte;
  }
}

async function run(
  clock: FakeClock,
  gate: DownloadGate,
  sessions: Session[],
  seconds: number,
  onSecond?: (sec: number) => void,
): Promise<void> {
  for (const session of sessions) {
    void (async () => {
      for (;;) {
        // The real encoder stops reading once it is a full read-ahead window ahead.
        if (session.lead >= WINDOW_SEC) {
          await clock.sleep(50);
          continue;
        }
        await gate.acquire(CHUNK, session.priority);
        session.credit(CHUNK);
        if (session.gapMs > 0) await clock.sleep(session.gapMs);
        if (session.paced) await clock.sleep(Math.max(1, Math.round(CHUNK * session.secPerByte * 1000)));
      }
    })();
  }
  const start = clock.now();
  let nextSecond = start + 1000;
  await clock.advance(seconds * 1000, (now) => {
    for (const session of sessions) session.tick(now);
    if (now >= nextSecond) {
      nextSecond += 1000;
      onSecond?.((now - start) / 1000);
    }
  });
}

describe('pickNext with a guard', () => {
  const waiter = (priority: Priority, since = 0, seq = 0) => ({ priority, since, seq });
  const big = (seq: number) => waiter({ rank: RANK_ENCODER, lead: 90 }, 0, seq);
  const mid = (seq: number) => waiter({ rank: RANK_ENCODER, lead: 40 }, 0, seq);
  const small = (seq: number) => waiter({ rank: RANK_ENCODER, lead: 5 }, 0, seq);

  it('skips encoders above the high lead whatever the bucket holds', () => {
    expect(pickNext([big(1), mid(2)], 0, { surplus: true })?.seq).toBe(2);
    expect(pickNext([big(1)], 0, { surplus: true })).toBeUndefined();
    expect(pickNext([big(1)], 0, null)?.seq).toBe(1);
  });

  it('serves encoders between the low and high lead only from a surplus', () => {
    expect(pickNext([mid(1)], 0, { surplus: false })).toBeUndefined();
    expect(pickNext([mid(1)], 0, { surplus: true })?.seq).toBe(1);
  });

  it('never holds back the encoder that is at risk', () => {
    expect(pickNext([big(1), mid(2), small(3)], 0, { surplus: false })?.seq).toBe(3);
  });

  it('does not let a held back request age ahead of the others', () => {
    const waiters = [big(1), waiter({ rank: RANK_ENCODER, lead: 40 }, 4000, 2)];
    expect(pickNext(waiters, 5000, { surplus: true })?.seq).toBe(2);
    expect(pickNext([big(1), mid(2)], 5000, { surplus: false })).toBeUndefined();
  });

  it('keeps extractor readers on their own rank', () => {
    expect(pickNext([waiter({ rank: RANK_EXTRACTOR, lead: 200 }, 0, 1)], 0, { surplus: false })?.seq).toBe(1);
  });
});

describe('DownloadGate lead priority under overload', () => {
  const cap = 60;

  it('keeps the low-lead session fed and holds the large-lead one (A 44 Mbps lead 8 s, B 21 Mbps lead 61 s)', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(cap, clock);
    const a = new Session(44, 8, false, 10);
    const b = new Session(21, 61);
    await run(clock, gate, [a, b], 30);

    expect(a.stalls).toBe(0);
    expect((a.bytes * 8) / 1_000_000 / 30).toBeGreaterThanOrEqual(44);
    expect(((a.bytes + b.bytes) * 8) / 1_000_000 / 30).toBeLessThanOrEqual(cap * 1.05);
  });

  it('holds a session more than 60 s ahead to at most its real-time need while the other has a low lead', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(cap, clock);
    const a = new Session(44, 8, false, 10);
    const b = new Session(21, 100);
    let heldWindowBytes = 0;
    let heldWindowSec = 0;
    let bAtStart = 0;
    await run(clock, gate, [a, b], 30, (sec) => {
      if (sec === 1) bAtStart = b.bytes;
      if (b.lead > HIGH_LEAD_SEC && a.lead < LOW_LEAD_SEC) {
        heldWindowSec = sec - 1;
        heldWindowBytes = b.bytes - bAtStart;
      }
    });
    expect(heldWindowSec).toBeGreaterThan(10);
    expect((heldWindowBytes * 8) / 1_000_000 / heldWindowSec).toBeLessThanOrEqual(21);
    expect(a.stalls).toBe(0);
  });

  it('serves the low-lead session first even when the large-lead one has waited past the aging time', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(10, clock);
    await gate.acquire(5_000_000, { rank: RANK_ENCODER, lead: 0 });
    const order: string[] = [];
    void gate.acquire(CHUNK, { rank: RANK_ENCODER, lead: 120 }).then(() => order.push('big'));
    await clock.advance(1600);
    void gate.acquire(CHUNK, { rank: RANK_ENCODER, lead: 3 }).then(() => order.push('small'));
    await clock.advance(30_000);
    expect(order).toEqual(['small', 'big']);
  });

  it('lets a large-lead reader through when no low-lead session has waited recently', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(cap, clock);
    const b = new Session(21, 100);
    await run(clock, gate, [b], 5);
    expect(b.bytes).toBeGreaterThan(mbpsToBytesPerSec(21) * 5);
  });

  it('forgets a low-lead session that stopped waiting after the memory time', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(10, clock);
    await gate.acquire(5_000_000, { rank: RANK_ENCODER, lead: 0 });
    const controller = new AbortController();
    void gate.acquire(CHUNK, { rank: RANK_ENCODER, lead: 2 }, controller.signal);
    await clock.advance(10);
    controller.abort();
    let granted = false;
    void gate.acquire(CHUNK, { rank: RANK_ENCODER, lead: 120 }).then(() => (granted = true));
    await clock.advance(LOW_LEAD_MEMORY_MS - 100);
    expect(granted).toBe(false);
    await clock.advance(30_000);
    expect(granted).toBe(true);
  });

  it('resumes the large-lead session once its lead drops below 60 s, without starving it', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(cap, clock);
    const a = new Session(44, 8, false, 10);
    const b = new Session(21, 100);
    let resumedAt = -1;
    let bAtSixty = 0;
    await run(clock, gate, [a, b], 90, (sec) => {
      if (resumedAt < 0 && b.lead <= HIGH_LEAD_SEC) {
        resumedAt = sec;
        bAtSixty = b.bytes;
      }
    });
    expect(resumedAt).toBeGreaterThan(30);
    expect(b.bytes).toBeGreaterThan(bAtSixty);
    expect(a.stalls).toBe(0);
    expect(b.stalls).toBe(0);
  });

  it('never exceeds the cap in any 5 s window with the priority rule active', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(cap, clock);
    const a = new Session(44, 8, false, 10);
    const b = new Session(21, 100);
    const log: Array<{ at: number; bytes: number }> = [];
    const spy = (session: Session): void => {
      const credit = session.credit.bind(session);
      session.credit = (bytes: number) => {
        log.push({ at: clock.now(), bytes });
        credit(bytes);
      };
    };
    spy(a);
    spy(b);
    await run(clock, gate, [a, b], 40);
    const limit = mbpsToBytesPerSec(cap) * 5 * 1.05;
    let worst = 0;
    for (let start = 0; start <= 35_000; start += 250) {
      const sum = log
        .filter((entry) => entry.at >= start && entry.at < start + 5000)
        .reduce((total, entry) => total + entry.bytes, 0);
      worst = Math.max(worst, sum);
    }
    expect(worst).toBeLessThanOrEqual(limit);
  });
});

describe('DownloadGate lead priority under underload', () => {
  it('lets both sessions download at their need when the cap is not binding (A 20 Mbps lead 8 s, B 21 Mbps lead 100 s)', async () => {
    const clock = new FakeClock();
    const gate = new DownloadGate(60, clock);
    const a = new Session(20, 8, true);
    const b = new Session(21, 100, true);
    await run(clock, gate, [a, b], 20);
    expect(a.stalls).toBe(0);
    expect(b.stalls).toBe(0);
    expect((a.bytes * 8) / 1_000_000 / 20).toBeGreaterThan(19);
    expect((b.bytes * 8) / 1_000_000 / 20).toBeGreaterThan(20);
    expect(gate.limitedForSec()).toBe(0);
  });
});
