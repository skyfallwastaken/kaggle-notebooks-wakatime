import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserCommand } from "vitest/node";
import type { BrowserContext, Frame, Page, Worker } from "playwright";

interface ExtensionStorageArea {
  clear(): Promise<void>;
  get(keys: null | string | string[]): Promise<Record<string, unknown>>;
  remove(keys: string | string[]): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ExtensionMessageSender { url?: string; tab?: { id?: number; url?: string } }
type ExtensionMessageListener = (message: unknown, sender: ExtensionMessageSender) => void;

declare const chrome: {
  runtime: { onMessage: { addListener(listener: ExtensionMessageListener): void; removeListener(listener: ExtensionMessageListener): void } };
  storage: { local: ExtensionStorageArea; session: ExtensionStorageArea };
};

const BRIDGE_EVENT = "kaggle-wakatime:activity";
const TEST_KEY = "real-kaggle-browser-test-key";
const EXPECTED_FIELDS = [
  "category", "cursorpos", "dependencies", "editor", "entity", "human_line_changes",
  "is_write", "language", "line_additions", "line_deletions", "lineno", "lines", "machine",
  "operating_system", "plugin", "project", "project_root_count", "time", "type", "user_agent",
].sort();

interface CapturedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: string;
}

interface Heartbeat {
  [key: string]: unknown;
  cursorpos: number;
  dependencies: string[];
  entity: string;
  human_line_changes: number;
  is_write: boolean;
  line_additions: number;
  line_deletions: number;
  lineno: number;
  lines: number;
  project_root_count: number;
  user_agent: string;
}

interface BridgeActivity {
  isWrite: boolean;
  lines: number;
  partial?: boolean;
}

interface ObservedActivity {
  message: BridgeActivity;
  senderOrigin?: string;
  tabId?: number;
}

export interface RealKaggleResult {
  fields: string[];
  request: {
    method: string | undefined; url: string; basicAuth: boolean;
    jsonContentType: boolean; localEndpoint: boolean;
  };
  metadata: { entity: string; projectRootCount: number };
  position: { lines: number; lineno: number; cursorpos: number };
  activity: {
    complete: boolean; isWrite: boolean; dependencies: boolean; deliveryStatus: boolean; forcedSave: boolean; outerMetadata: boolean; workerReceived: boolean;
    lineAdditions: number; lineDeletions: number; humanLineChanges: number;
  };
  privacy: { sourceExcluded: boolean; keyExcluded: boolean };
}

interface CommandOptions { cookie: string; notebookUrl: string }

async function startCaptureServer() {
  const directory = mkdtempSync(join(tmpdir(), "kaggle-wakatime-capture-"));
  const keyPath = join(directory, "key.pem"), certificatePath = join(directory, "certificate.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certificatePath, "-subj", "/CN=localhost",
  ], { stdio: "ignore" });
  const requests: CapturedRequest[] = [];
  const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      requests.push({
        url: `https://${request.headers.host ?? "hackatime.hackclub.com"}${request.url ?? ""}`, method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).flatMap(([name, value]) => value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]])),
        body,
      });
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Could not start the local heartbeat capture server");
  return {
    endpoint: `https://hackatime.hackclub.com:${address.port}/heartbeats`, requests,
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function cookiesFromHeader(header: string) {
  return header.trim().replace(/^['"]|['"]$/g, "").split(";").flatMap(part => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    return [{
      name: part.slice(0, separator).trim(),
      value: part.slice(separator + 1).trim(),
      url: "https://www.kaggle.com",
    }];
  });
}

function notebookIdentity(rawUrl: string) {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/^\/code\/([^/]+)\/([^/]+)\/edit\/?$/);
  requireCondition(url.origin === "https://www.kaggle.com" && match, "KAGGLE_NOTEBOOK_URL must be a Kaggle notebook edit URL");
  return { owner: match[1]!, slug: match[2]!, entity: `/kaggle/notebooks/${match[1]}/${match[2]}.ipynb` };
}

async function waitFor<T>(read: () => Promise<T | undefined>, failure: string, timeout = 30_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(failure);
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers().find(worker => worker.url().startsWith("chrome-extension://"))
    ?? context.waitForEvent("serviceworker", {
      predicate: worker => worker.url().startsWith("chrome-extension://"),
      timeout: 30_000,
    });
}

function payload(request: CapturedRequest): Heartbeat {
  try {
    const parsed = JSON.parse(request.body) as unknown;
    requireCondition(Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === "object", "Extension sent invalid heartbeat JSON");
    return parsed[0] as Heartbeat;
  } catch (error) {
    if (error instanceof Error && error.message === "Extension sent invalid heartbeat JSON") throw error;
    throw new Error("Extension sent invalid heartbeat JSON");
  }
}

async function waitForRequest(requests: CapturedRequest[], predicate: (heartbeat: Heartbeat) => boolean, failure: string) {
  return waitFor(async () => [...requests].reverse().find(request => {
    try { return predicate(payload(request)); } catch { return false; }
  }), failure);
}

async function kaggleFrame(page: Page): Promise<Frame> {
  return waitFor(async () => page.frames().find(frame => frame.url().includes("jupyter-proxy.kaggle.net")), "Real Kaggle Jupyter frame did not load", 60_000);
}

async function singleCellSource(frame: Frame) {
  return frame.evaluate(() => {
    const app = (globalThis as typeof globalThis & { jupyterapp?: any }).jupyterapp;
    const widgets = app?.shell?.currentWidget?.content?.widgets;
    if (!Array.isArray(widgets) || widgets.length !== 1) return undefined;
    const source = widgets[0]?.model?.sharedModel?.getSource?.();
    return typeof source === "string" ? source : undefined;
  });
}

async function metadataMessage(worker: Worker, entity: string) {
  return waitFor(async () => worker.evaluate(expectedEntity => {
    const messages = (globalThis as typeof globalThis & {
      __kaggleWakatimeMetadata?: { message: unknown; senderUrl?: string }[];
    }).__kaggleWakatimeMetadata ?? [];
    return messages.find(item => {
      const message = item.message as { kind?: unknown; metadata?: { entity?: unknown } };
      return message.kind === "metadata" && message.metadata?.entity === expectedEntity;
    });
  }, entity), "Outer Kaggle content script did not send notebook metadata");
}

export function createRealKaggleCommand(options: CommandOptions): BrowserCommand<[], RealKaggleResult> {
  return async ({ provider, context }) => {
    requireCondition(provider.name === "playwright", "Real Kaggle tests require the Playwright browser provider");
    const identity = notebookIdentity(options.notebookUrl);
    const cookies = cookiesFromHeader(options.cookie);
    requireCondition(cookies.length > 0, "KAGGLE does not contain any browser cookies");

    const marker = `# KAGGLE_WAKATIME_BROWSER_TEST_${crypto.randomUUID()}`;
    const capture = await startCaptureServer();

    const worker = await extensionWorker(context);
    const workerConsole: string[] = [];
    worker.on("console", message => { workerConsole.push(`${message.type()}: ${message.text()}`); });
    const extensionId = new URL(worker.url()).host;
    const previousStorage = await worker.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      session: await chrome.storage.session.get(null),
    }));
    let optionsPage: Page | undefined;
    let notebookPage: Page | undefined;
    let frame: Frame | undefined;
    let baselineSource: string | undefined;
    let mutatedSource: string | undefined;
    let mutated = false;
    let result: RealKaggleResult | undefined;
    let cleanupError: unknown;
    let testError: unknown;
    let stage = "extension setup";

    try {
      await worker.evaluate(async () => {
        const scope = globalThis as typeof globalThis & {
          __kaggleWakatimeMetadata?: { message: unknown; senderUrl?: string }[];
          __kaggleWakatimeActivities?: ObservedActivity[];
          __kaggleWakatimeMetadataListener?: ExtensionMessageListener;
        };
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        scope.__kaggleWakatimeMetadata = [];
        scope.__kaggleWakatimeActivities = [];
        scope.__kaggleWakatimeMetadataListener = (message, sender) => {
          const value = message as { kind?: unknown };
          if (value?.kind === "metadata") {
            scope.__kaggleWakatimeMetadata!.push({ message, senderUrl: sender.url ?? sender.tab?.url });
          }
          if (value?.kind === "activity") {
            scope.__kaggleWakatimeActivities!.push({
              message: message as BridgeActivity,
              senderOrigin: sender.url ? new URL(sender.url).origin : undefined,
              tabId: sender.tab?.id,
            });
          }
        };
        chrome.runtime.onMessage.addListener(scope.__kaggleWakatimeMetadataListener);
      });

      stage = "options page";
      optionsPage = await context.newPage();
      await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
      await optionsPage.getByLabel("API key").fill(TEST_KEY);
      await optionsPage.getByLabel("API endpoint").fill(capture.endpoint);
      await optionsPage.getByRole("button", { name: "Save and test" }).click();
      await optionsPage.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("Connection test passed"));
      const testRequest = await waitForRequest(capture.requests, heartbeat => heartbeat.entity === "test.txt", "Installed extension options did not send a test heartbeat");
      const testHeartbeat = payload(testRequest);
      requireCondition(Object.keys(testHeartbeat).sort().join(",") === EXPECTED_FIELDS.join(","), "Connection test heartbeat did not include the exact field set");
      requireCondition(/^Basic /.test(testRequest.headers.authorization ?? "") && testRequest.headers["content-type"] === "application/json", "Connection test heartbeat used the wrong authentication or content type");
      requireCondition(!testRequest.body.includes(TEST_KEY), "Connection test heartbeat exposed the API key in its body");
      capture.requests.length = 0;

      stage = "Kaggle notebook load";
      await context.addCookies(cookies);
      notebookPage = await context.newPage();
      await notebookPage.goto(options.notebookUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      requireCondition(new URL(notebookPage.url()).pathname.includes(`/${identity.owner}/${identity.slug}/edit`), "KAGGLE cookie did not authenticate to the configured notebook");
      const outerMetadata = await metadataMessage(worker, identity.entity);
      requireCondition(outerMetadata.senderUrl && new URL(outerMetadata.senderUrl).pathname === new URL(options.notebookUrl).pathname, "Outer Kaggle metadata came from the wrong page");
      await notebookPage.waitForTimeout(12_000);

      frame = await kaggleFrame(notebookPage);
      const editors = frame.locator(".cm-content");
      await editors.first().waitFor({ state: "visible", timeout: 60_000 });
      const baselineEditorCount = await editors.count();
      const staleTestCells = (await Promise.all(Array.from({ length: baselineEditorCount }, (_, index) => editors.nth(index).innerText())))
        .filter(source => source.includes("KAGGLE_WAKATIME_BROWSER_TEST")).length;
      requireCondition(baselineEditorCount === 1, `Real Kaggle test notebook must contain exactly one cell; found ${baselineEditorCount} with ${staleTestCells} stale test cells`);
      baselineSource = await waitFor(() => singleCellSource(frame!), "Could not read the exact baseline source from real Kaggle");
      requireCondition(!baselineSource.includes("KAGGLE_WAKATIME_BROWSER_TEST"), "Real Kaggle test notebook contains stale test content");
      await frame.evaluate(eventName => {
        const scope = globalThis as typeof globalThis & { __kaggleWakatimeBridge?: Record<string, unknown>[] };
        scope.__kaggleWakatimeBridge = [];
        document.addEventListener(eventName, event => {
          scope.__kaggleWakatimeBridge!.push(JSON.parse((event as CustomEvent<string>).detail));
        });
      }, BRIDGE_EVENT);

      const firstEditor = editors.first();
      await worker.evaluate(async entity => {
        await chrome.storage.local.remove(`last:${entity}`);
        await chrome.storage.local.remove("deliveryStatus");
        await chrome.storage.session.remove(`last:${entity}`);
      }, identity.entity);
      capture.requests.length = 0;
      await firstEditor.press("Control+s");
      let initialRequest: CapturedRequest;
      try {
        initialRequest = await waitForRequest(capture.requests, () => true, "Installed extension did not send an initial heartbeat");
      } catch {
        const bridge = await frame.evaluate(() => {
          const activities = (globalThis as typeof globalThis & { __kaggleWakatimeBridge?: BridgeActivity[] }).__kaggleWakatimeBridge ?? [];
          return activities.map(activity => ({ isWrite: activity.isWrite, lines: activity.lines }));
        });
        const workerState = await worker.evaluate(async expectedEndpoint => {
          const scope = globalThis as typeof globalThis & { __kaggleWakatimeActivities?: ObservedActivity[] };
          const values = await chrome.storage.local.get(["apiKey", "endpoint"]);
          const session = await chrome.storage.session.get(null);
          return {
            activities: (scope.__kaggleWakatimeActivities ?? []).map(activity => ({
              isWrite: activity.message.isWrite,
              lines: activity.message.lines,
              senderOrigin: activity.senderOrigin,
              tabId: activity.tabId,
            })),
            hasKey: typeof values.apiKey === "string",
            endpointMatches: values.endpoint === expectedEndpoint,
            sessionKeys: Object.keys(session),
          };
        }, capture.endpoint);
        throw new Error(`Installed extension did not send an initial heartbeat; bridge ${JSON.stringify(bridge)}; worker ${JSON.stringify(workerState)}; console ${JSON.stringify(workerConsole)}; captured ${capture.requests.length}`);
      }
      const initial = payload(initialRequest);
      requireCondition(initial.entity === identity.entity, "Real Kaggle metadata produced the wrong heartbeat entity");
      const initialBridge = await waitFor(async () => frame!.evaluate(lines => {
        const activities = (globalThis as typeof globalThis & { __kaggleWakatimeBridge?: BridgeActivity[] }).__kaggleWakatimeBridge ?? [];
        return [...activities].reverse().find(activity => activity.isWrite && activity.lines === lines);
      }, initial.lines), "MAIN world did not publish the initial real Kaggle activity");
      requireCondition(initialBridge.partial !== true && initial.lines === baselineSource.split("\n").length, "Real Kaggle test notebook baseline is not one complete cell");

      stage = "real Kaggle cell edit";
      const editStartedAt = Date.now();
      await worker.evaluate(async ({ entity, at }) => {
        await chrome.storage.local.remove(`last:${entity}`);
        await chrome.storage.session.remove(`last:${entity}`);
        await chrome.storage.local.set({ deliveryStatus: { state: "not_configured", message: "Waiting for the next Kaggle edit.", at, entity } });
      }, { entity: identity.entity, at: editStartedAt });
      await optionsPage.waitForFunction(() => document.querySelector("#delivery-status")?.textContent?.includes("Waiting for the next Kaggle edit."));
      capture.requests.length = 0;
      await frame.evaluate(() => {
        (globalThis as typeof globalThis & { __kaggleWakatimeBridge?: BridgeActivity[] }).__kaggleWakatimeBridge = [];
      });

      mutated = true;
      const intendedMutatedSource = `${baselineSource}\n${marker}\nimport pandas as pd\nanswer = 42`;
      await firstEditor.fill(intendedMutatedSource);
      mutatedSource = await waitFor(async () => {
        const source = await singleCellSource(frame!);
        return source === intendedMutatedSource ? source : undefined;
      }, "Real Kaggle model did not accept the exact test mutation");
      await firstEditor.press("Control+End");
      const expectedLines = initial.lines + 3;
      const editRequest = await waitForRequest(capture.requests, heartbeat => heartbeat.is_write && heartbeat.lines === expectedLines, "Installed extension did not send the real Kaggle edit heartbeat");
      const edit = payload(editRequest);
      const bridgeActivity = await waitFor(async () => frame!.evaluate(lines => {
        const activities = (globalThis as typeof globalThis & { __kaggleWakatimeBridge?: BridgeActivity[] }).__kaggleWakatimeBridge ?? [];
        return [...activities].reverse().find(activity => activity.isWrite && activity.lines === lines);
      }, expectedLines), "MAIN world did not publish the real Kaggle edit activity");
      const workerActivity = await waitFor(async () => worker.evaluate(lines => {
        const activities = (globalThis as typeof globalThis & { __kaggleWakatimeActivities?: ObservedActivity[] }).__kaggleWakatimeActivities ?? [];
        return [...activities].reverse().find(activity => activity.message.isWrite && activity.message.lines === lines);
      }, expectedLines), "Extension service worker did not receive the real Kaggle edit activity");
      const editDeliveryStatus = await waitFor(async () => worker.evaluate(async expected => {
        const status = (await chrome.storage.local.get("deliveryStatus")).deliveryStatus as { state?: unknown; entity?: unknown; at?: unknown } | undefined;
        return status?.state === "sent" && status.entity === expected.entity && typeof status.at === "number" && status.at > expected.after ? true : undefined;
      }, { entity: identity.entity, after: editStartedAt }), "Extension did not record the real Kaggle edit as delivered");
      await optionsPage.waitForFunction(() => {
        const status = document.querySelector<HTMLElement>("#delivery-status");
        return status?.dataset.state === "sent" && status.textContent?.includes("Heartbeat accepted for");
      });

      capture.requests.length = 0;
      await firstEditor.press("Control+s");
      const saveRequest = await waitForRequest(capture.requests, heartbeat => heartbeat.is_write && heartbeat.lines === expectedLines, "A real Kaggle save did not bypass heartbeat throttling");
      const save = payload(saveRequest);

      const expectedDependencies = [...new Set([...initial.dependencies, "pandas"])].sort();
      requireCondition(edit.entity === identity.entity, "Real Kaggle edit heartbeat used the wrong entity");
      requireCondition(JSON.stringify(edit.dependencies) === JSON.stringify(expectedDependencies), "Real Kaggle edit heartbeat dependencies were incorrect");
      requireCondition(edit.user_agent.startsWith("kaggle-wakatime/0.1.3 "), "Real Kaggle heartbeat used the wrong user agent prefix");

      result = {
        fields: Object.keys(edit).sort(),
        request: {
          method: editRequest.method, url: editRequest.url,
          basicAuth: /^Basic /.test(editRequest.headers.authorization ?? ""),
          jsonContentType: editRequest.headers["content-type"] === "application/json",
          localEndpoint: editRequest.url === capture.endpoint,
        },
        metadata: { entity: edit.entity, projectRootCount: edit.project_root_count },
        position: { lines: edit.lines, lineno: edit.lineno, cursorpos: edit.cursorpos },
        activity: {
          complete: bridgeActivity.partial !== true,
          isWrite: edit.is_write,
          dependencies: true,
          deliveryStatus: editDeliveryStatus,
          forcedSave: save.is_write,
          outerMetadata: true,
          workerReceived: Boolean(workerActivity),
          lineAdditions: edit.line_additions,
          lineDeletions: edit.line_deletions,
          humanLineChanges: edit.human_line_changes,
        },
        privacy: {
          sourceExcluded: !editRequest.body.includes(marker),
          keyExcluded: !editRequest.body.includes(TEST_KEY),
        },
      };

      requireCondition(result.fields.join(",") === EXPECTED_FIELDS.join(","), "Real Kaggle heartbeat did not include the exact field set");
      requireCondition(edit.lineno === expectedLines && edit.cursorpos === 12, "Real Kaggle global line or cursor position was incorrect");
      requireCondition(edit.line_additions === 3 && edit.line_deletions === 0 && edit.human_line_changes === 3, "Real Kaggle edit metrics were incorrect");
    } catch (error) {
      testError = new Error(`Real Kaggle test failed during ${stage}: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      if (notebookPage && frame && mutated && baselineSource !== undefined) {
        try {
          const editor = frame.locator(".cm-content").first();
          const currentSource = await waitFor(() => singleCellSource(frame!), "Could not read the current source before real Kaggle cleanup");
          if (currentSource !== baselineSource) {
            requireCondition(
              mutatedSource !== undefined && currentSource === mutatedSource,
              `Real Kaggle source changed after test marker ${marker}; refusing to overwrite it`,
            );
            await editor.fill(baselineSource);
            await editor.press("Control+s");
            await notebookPage.waitForTimeout(3_000);
          }
          await notebookPage.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
          await notebookPage.waitForTimeout(12_000);
          const reloadedFrame = await kaggleFrame(notebookPage);
          const reloadedEditors = reloadedFrame.locator(".cm-content");
          await reloadedEditors.first().waitFor({ state: "visible", timeout: 60_000 });
          const reloadedSource = await waitFor(() => singleCellSource(reloadedFrame), "Could not read the restored source from real Kaggle");
          requireCondition(
            await reloadedEditors.count() === 1
              && reloadedSource === baselineSource,
            "Real Kaggle test notebook was not durably restored",
          );
        } catch (error) {
          cleanupError = new Error(`Real Kaggle cleanup failed: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      await notebookPage?.close().catch(() => undefined);
      await optionsPage?.close().catch(() => undefined);
      await context.clearCookies({ domain: /kaggle/ }).catch(() => undefined);
      const currentWorker = context.serviceWorkers().find(candidate => candidate.url().startsWith(`chrome-extension://${extensionId}/`));
      await currentWorker?.evaluate(async previous => {
        const scope = globalThis as typeof globalThis & {
          __kaggleWakatimeMetadata?: unknown[];
          __kaggleWakatimeActivities?: unknown[];
          __kaggleWakatimeMetadataListener?: ExtensionMessageListener;
        };
        if (scope.__kaggleWakatimeMetadataListener) chrome.runtime.onMessage.removeListener(scope.__kaggleWakatimeMetadataListener);
        delete scope.__kaggleWakatimeMetadata;
        delete scope.__kaggleWakatimeActivities;
        delete scope.__kaggleWakatimeMetadataListener;
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        await chrome.storage.local.set(previous.local);
        await chrome.storage.session.set(previous.session);
      }, previousStorage).catch(() => undefined);
      await capture.close().catch(() => undefined);
    }

    if (cleanupError) throw cleanupError;
    if (testError) throw testError;
    requireCondition(result, "Real Kaggle browser test did not complete");
    return result;
  };
}
