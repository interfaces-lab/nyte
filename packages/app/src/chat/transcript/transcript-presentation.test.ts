import { expect, test } from "vitest";
import { replyAge, workedFor } from "./transcript-presentation.ts";

test("a turn's work rounds up to the second", () => {
  expect(workedFor(1)).toBe("Worked for 1s");
  expect(workedFor(46_001)).toBe("Worked for 47s");
  expect(workedFor(166_100)).toBe("Worked for 2m 47s");
  expect(workedFor(120_000)).toBe("Worked for 2m");
  expect(workedFor(3_900_000)).toBe("Worked for 1h 5m");
  expect(workedFor(3_600_000)).toBe("Worked for 1h");
});

test("a reply's age reads just now under a minute, then minutes through years", () => {
  const now = Date.UTC(2026, 0, 1);
  const ago = (ms: number) => replyAge(now - ms, now);

  expect(ago(59_999)).toBe("Just now");
  expect(ago(-5_000)).toBe("Just now");
  expect(ago(4 * 60_000)).toBe("4m ago");
  expect(ago(4 * 3_600_000)).toBe("4h ago");
  expect(ago(3 * 86_400_000)).toBe("3d ago");
  expect(ago(65 * 86_400_000)).toBe("2mo ago");
  expect(ago(400 * 86_400_000)).toBe("1y ago");
});
