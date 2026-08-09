import { expect, test } from "vitest";
import { commands } from "vitest/browser";
import type { RealKaggleResult } from "./support/real-kaggle";

declare module "vitest/browser" {
  interface BrowserCommands {
    realKaggle(): Promise<RealKaggleResult>;
  }
}

test("runs the installed extension against real Kaggle", { timeout: 120_000 }, async () => {
  const result = await commands.realKaggle();
  expect(result.request).toEqual({
    method: "POST",
    url: expect.stringMatching(/^https:\/\/hackatime\.hackclub\.com:\d+\/heartbeats$/),
    basicAuth: true,
    jsonContentType: true,
    localEndpoint: true,
  });
  expect(result.metadata).toMatchObject({
    entity: expect.stringMatching(/^\/kaggle\/notebooks\/[^/]+\/[^/]+\.ipynb$/),
    projectRootCount: 3,
  });
  expect(result.position.lines).toBeGreaterThanOrEqual(4);
  expect(result.position).toMatchObject({
    lineno: result.position.lines,
    cursorpos: 12,
  });
  expect(result.activity).toEqual({
    complete: true,
    isWrite: true,
    dependencies: true,
    deliveryStatus: true,
    forcedSave: true,
    outerMetadata: true,
    workerReceived: true,
    lineAdditions: 3,
    lineDeletions: 0,
    humanLineChanges: 3,
  });
  expect(result.privacy).toEqual({ sourceExcluded: true, keyExcluded: true });
});
