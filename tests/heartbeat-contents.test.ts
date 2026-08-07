import { describe, expect, test, vi } from "vitest";
import { contentsUrl, fetchNotebook, mergeObservedCells, rememberVisibleCells } from "../lib/contents";
import { createPayload, createSubmitter, submit } from "../lib/heartbeat";
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
      machine: "machine", user_agent: navigator.userAgent,
      plugin: "kaggle-notebooks-wakatime/0.1.0", line_additions: 1,
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
