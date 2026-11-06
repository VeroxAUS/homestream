import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Vitest reporter that records the tests which failed at least once and then passed on a retry. */
export default class FlakyReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile;
    this.flaky = [];
  }

  onTestCaseResult(testCase) {
    const diagnostic = testCase.diagnostic();
    if (!diagnostic?.flaky) return;
    this.flaky.push({
      name: testCase.fullName,
      file: testCase.module.moduleId,
      retries: diagnostic.retryCount,
      durationMs: Math.round(diagnostic.duration),
    });
  }

  onTestRunEnd() {
    if (!this.outputFile) return;
    mkdirSync(path.dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify({ flaky: this.flaky }, null, 2)}\n`);
  }
}