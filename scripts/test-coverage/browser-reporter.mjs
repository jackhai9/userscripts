import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { relativeSourcePath } from './config.mjs';

/** Test completion and coverage completion are separate evidence requirements. */
export default class BrowserCoverageReporter {
  onBegin(config, suite) {
    this.tests = suite.allTests().map((test) => ({
      id: test.id,
      file: relativeSourcePath(test.location.file),
      title: test.titlePath().join(' > '),
    }));
    this.results = new Map();
  }

  onTestEnd(test, result) {
    this.results.set(test.id, { status: result.status, retry: result.retry });
  }

  async onEnd(result) {
    await writeFile(resolve(process.env.USERSCRIPTS_BROWSER_COVERAGE_DIRECTORY, 'manifest.json'), JSON.stringify({
      status: result.status,
      tests: this.tests.map((test) => ({ ...test, result: this.results.get(test.id) })),
    }, null, 2) + '\n');
  }
}
