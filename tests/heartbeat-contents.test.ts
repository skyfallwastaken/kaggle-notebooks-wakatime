import { describe, expect, test, vi } from "vitest";
import { contentsUrl, fetchNotebook, mergeObservedCells, rememberVisibleCells } from "../lib/contents";
import { createPayload, createSubmitter, HeartbeatRequestError, heartbeatFailureMessage, normaliseEndpoint, submit, testHeartbeatConnection } from "../lib/heartbeat";
const meta = { owner: "a", slug: "b", title: "B", entity: "/b", project: "B" };
const activity = { kind: "activity" as const, lines: 2, lineno: 1, cursorpos: 2, language: "Python", dependencies: ["numpy"], isWrite: true, force: false, lineAdditions: 1, lineDeletions: 0, humanLineChanges: 1 };

describe("heartbeat and contents boundaries", () => {
  test("creates privacy-safe exact heartbeat fields", () => {
    const payload = createPayload(meta, activity, "machine", 42);
    expect(payload).toEqual({
      entity: "/b", type: "file", category: "coding", time: 42, project: "B",
      language: "Python", dependencies: ["numpy"], lines: 2, lineno: 1,
      cursorpos: 2, is_write: true, project_root_count: 0,
      editor: "Kaggle Notebooks", operating_system: navigator.platform || "Unknown",
      machine: "machine", user_agent: `kaggle-wakatime/0.1.3 ${navigator.userAgent}`,
      plugin: "kaggle-notebooks-wakatime/0.1.3", line_additions: 1,
      line_deletions: 0, human_line_changes: 1,
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
  test("sends Basic auth then persists timestamp", async () => { const calls: [RequestInfo | URL, RequestInit | undefined][] = [], fetcher: typeof fetch = async (input, init) => { calls.push([input, init]); return new Response("", { status: 201 }); }, setLast = vi.fn(); await submit(meta, activity, { apiKey: "secret", endpoint: "https://example.com/h", machine: "m" }, { now: () => 200, fetch: fetcher, getLast: async () => 0, setLast }); const init = calls[0]![1]!; expect(init.headers).toMatchObject({ Authorization: `Basic ${btoa("secret")}` }); expect(JSON.parse(String(init.body))[0].entity).toBe("/b"); expect(setLast).toHaveBeenCalledWith("/b", 200); });
  test("throttles ordinary edits but forces saves", async () => { const fetcher = vi.fn(async () => new Response("", { status: 200 })), boundaries = { now: () => 200, fetch: fetcher as typeof fetch, getLast: async () => 150, setLast: async () => {} }; expect(await submit(meta, activity, { apiKey: "x", endpoint: "https://e.test", machine: "m" }, boundaries)).toBe(false); expect(await submit(meta, { ...activity, force: true }, { apiKey: "x", endpoint: "https://e.test", machine: "m" }, boundaries)).toBe(true); expect(fetcher).toHaveBeenCalledOnce(); });
  test("serializes concurrent activity for one entity", async () => {
    const send = createSubmitter();
    let last = 0;
    let release!: () => void;
    const firstResponse = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async () => {
      await firstResponse;
      return new Response("", { status: 202 });
    });
    const boundaries = {
      now: () => 200, fetch: fetcher as typeof fetch,
      getLast: async () => last, setLast: async (_entity: string, time: number) => { last = time; },
    };
    const first = send(meta, activity, { apiKey: "x", endpoint: "https://e.test", machine: "m" }, boundaries);
    const second = send(meta, activity, { apiKey: "x", endpoint: "https://e.test", machine: "m" }, boundaries);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  test("returns generic secret-safe transport errors", async () => { await expect(submit(meta, activity, { apiKey: "do-not-leak", endpoint: "https://e.test", machine: "m" }, { now: () => 200, fetch: vi.fn(async () => { throw new Error("do-not-leak"); }) as typeof fetch, getLast: async () => 0, setLast: async () => {} })).rejects.toThrow(/^Heartbeat request failed$/); });
  test("aborts requests at the configured timeout", async () => {
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    await expect(submit(meta, activity, { apiKey: "secret", endpoint: "https://e.test", machine: "m" }, {
      now: () => 200, fetch: fetcher, getLast: async () => 0, setLast: async () => {}, timeout: 1,
    })).rejects.toThrow(/^Heartbeat request failed$/);
  });
  test("trims the key and endpoint before delivery", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa("trimmed-key")}`);
      return new Response(null, { status: 202 });
    });
    await submit(meta, activity, { apiKey: "  trimmed-key\n", endpoint: "  https://example.com/heartbeats/  ", machine: "m" }, {
      now: () => 200, fetch: fetcher, getLast: async () => 0, setLast: async () => {},
    });
    expect(fetcher).toHaveBeenCalledWith("https://example.com/heartbeats", expect.any(Object));
  });
  test.each([
    [new Response(JSON.stringify({ error: "do-not-leak" }), { status: 401, headers: { "Content-Type": "application/json" } }), "The heartbeat endpoint rejected the API key."],
    [new Response("Forbidden", { status: 403 }), "The heartbeat endpoint refused this account."],
    [new Response("Invalid heartbeat", { status: 422 }), "The heartbeat endpoint rejected the heartbeat data."],
    [new Response("Slow down", { status: 429 }), "The heartbeat endpoint rate limit was reached."],
    [new Response("do-not-leak", { status: 503 }), "The heartbeat endpoint is temporarily unavailable."],
    [new Response("Teapot", { status: 418 }), "The heartbeat endpoint returned HTTP 418."],
  ])("reports a safe actionable server error", async (response, expected) => {
    const error = await testHeartbeatConnection(
      { apiKey: "do-not-leak", endpoint: "https://example.com/heartbeats" },
      vi.fn<typeof fetch>(async () => response),
    ).catch(value => value);
    expect(heartbeatFailureMessage(error)).toBe(expected);
    expect(heartbeatFailureMessage(error)).not.toContain("do-not-leak");
    expect(heartbeatFailureMessage(error)).not.toContain("Authorization");
  });
  test("preserves the HTTP status in a typed transport error", async () => {
    const error = await testHeartbeatConnection(
      { apiKey: "key", endpoint: "https://example.com/heartbeats" },
      vi.fn<typeof fetch>(async () => new Response(null, { status: 401 })),
    ).catch(value => value);
    expect(error).toBeInstanceOf(HeartbeatRequestError);
    expect(error).toMatchObject({ reason: "http", status: 401 });
  });
  test("distinguishes timeouts from other network failures", async () => {
    const timeout = await testHeartbeatConnection(
      { apiKey: "secret", endpoint: "https://example.com/heartbeats" },
      vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })),
      1,
    ).catch(value => value);
    const network = await testHeartbeatConnection(
      { apiKey: "secret", endpoint: "https://example.com/heartbeats" },
      vi.fn<typeof fetch>(async () => { throw new TypeError("secret internal failure"); }),
    ).catch(value => value);
    expect(heartbeatFailureMessage(timeout)).toBe("The heartbeat endpoint timed out.");
    expect(heartbeatFailureMessage(network)).toBe("The heartbeat endpoint could not be reached.");
    expect(heartbeatFailureMessage(network)).not.toContain("secret");
  });
  test("does not throttle a retry after rejected delivery", async () => {
    let last = 0;
    const boundaries = {
      now: () => 200, getLast: async () => last, setLast: async (_entity: string, time: number) => { last = time; },
    };
    await expect(submit(meta, activity, { apiKey: "key", endpoint: "https://example.com/heartbeats", machine: "m" }, {
      ...boundaries, fetch: vi.fn<typeof fetch>(async () => new Response("Unauthorized", { status: 401 })),
    })).rejects.toThrow();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    await expect(submit(meta, activity, { apiKey: "key", endpoint: "https://example.com/heartbeats", machine: "m" }, {
      ...boundaries, fetch: fetcher,
    })).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(last).toBe(200);
  });
  test("sends a complete test heartbeat instead of a reduced probe", async () => {
    let body = "";
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 202 });
    });
    await testHeartbeatConnection({ apiKey: "key", endpoint: "https://example.com/heartbeats" }, fetcher);
    const heartbeat = JSON.parse(body)[0];
    expect(Object.keys(heartbeat).sort()).toEqual([
      "category", "cursorpos", "dependencies", "editor", "entity", "human_line_changes", "is_write",
      "language", "line_additions", "line_deletions", "lineno", "lines", "machine", "operating_system",
      "plugin", "project", "project_root_count", "time", "type", "user_agent",
    ]);
    expect(heartbeat).toMatchObject({ entity: "test.txt", project: "Kaggle Notebooks", language: "Text", lines: 1, lineno: 1, cursorpos: 1, is_write: false, editor: "Kaggle Notebooks", machine: "kaggle-connection-test" });
  });
  test("normalises configured endpoints without changing their path", () => {
    expect(normaliseEndpoint("  https://example.com/custom/path///  ")).toBe("https://example.com/custom/path");
  });
  test("encodes Contents paths and query", () => expect(contentsUrl("https://host.test/base/", "folder/a b.ipynb")).toBe("https://host.test/base/api/contents/folder/a%20b.ipynb?content=1&type=notebook&format=json"));
  test("uses same-origin JSON Contents requests", async () => { const calls: (RequestInit | undefined)[] = [], fetcher: typeof fetch = async (_input, init) => { calls.push(init); return Response.json({ content: { cells: [] } }); }; expect(await fetchNotebook(fetcher, "https://host.test/", ["book"])).toEqual([]); expect(calls[0]).toMatchObject({ credentials: "same-origin", headers: { Accept: "application/json" } }); });
  test("tries Contents candidates until a notebook succeeds", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes("missing")
      ? new Response("", { status: 404 })
      : Response.json({ content: { cells: [{ cell_type: "code", source: "ok" }] } }));
    expect(await fetchNotebook(fetcher as typeof fetch, "https://host.test/", ["missing", "book"]))
      .toEqual([{ cell_type: "code", source: "ok" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test("keeps observed unsaved cells across active cell changes", () => {
    const observed = new Map();
    const server = [
      { cell_type: "code", source: "import old" },
      { cell_type: "code", source: "second" },
    ];
    rememberVisibleCells(observed, [{ cell_type: "code", source: "import new\nvalue = 1", index: 0 }]);
    expect(mergeObservedCells(server, observed)[0]).toMatchObject({
      source: "import new\nvalue = 1", index: 0,
    });
    rememberVisibleCells(observed, [{ cell_type: "code", source: "second changed", index: 1 }]);
    expect(mergeObservedCells(server, observed).map(cell => cell.source)).toEqual([
      "import new\nvalue = 1", "second changed",
    ]);
  });
  test("includes newly inserted visible cells missing from cached Contents", () => {
    const observed = new Map();
    rememberVisibleCells(observed, [{ cell_type: "code", source: "new cell", index: 1 }]);
    expect(mergeObservedCells([{ cell_type: "code", source: "first" }], observed)).toEqual([
      { cell_type: "code", source: "first", index: 0 },
      { cell_type: "code", source: "new cell", index: 1 },
    ]);
  });
});
