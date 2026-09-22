import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface CapturedResult {
  readonly id: string;
  readonly title: string;
  readonly status: TestResult["status"];
  readonly records: readonly string[];
}

export default class DesktopBenchmarkReporter implements Reporter {
  private outputDirectory = "";
  private tests: TestCase[] = [];
  private results: CapturedResult[] = [];

  onBegin(config: FullConfig, suite: Suite): void {
    this.outputDirectory =
      config.projects[0]?.outputDir ?? join(config.rootDir, "benchmark-results");
    this.tests = suite.allTests();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const text = Buffer.concat(result.stdout.map((chunk) => Buffer.from(chunk))).toString("utf8");

    this.results.push({
      id: test.id,
      title: test.titlePath().slice(1).join(" > "),
      status: result.status,
      records: text
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("BENCHMARK "))
        .map((line) => line.slice("BENCHMARK ".length)),
    });
  }

  async onEnd(result: FullResult): Promise<void | { readonly status: "failed" }> {
    const file = join(this.outputDirectory, "desktop-benchmark.jsonl");

    try {
      await mkdir(this.outputDirectory, { recursive: true });
      await writeFile(
        file,
        this.results.flatMap((entry) => entry.records.map((record) => `${record}\n`)).join(""),
        "utf8",
      );
    } catch (cause) {
      process.stderr.write(
        `Could not save desktop benchmark records: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );

      return { status: "failed" };
    }

    const completed = new Set(this.results.map((entry) => entry.id));
    const unrun = this.tests.filter((test) => !completed.has(test.id)).length;
    const missing = this.results.filter((entry) => entry.records.length === 0).length + unrun;
    const passed = this.results.filter((entry) => entry.status === "passed").length;
    process.stdout.write(
      `\nDesktop benchmark: ${result.status}; passed=${String(passed)}; missing=${String(missing)}\nRaw records: ${file}\n`,
    );
  }
}
