import { describe, expect, test, vi } from "vitest";
import { createMachineGetter, createMessageHandler, deliverActivity } from "../lib/background";
import { BRIDGE_EVENT, installBridgeRelay } from "../lib/bridge";
import { parseKaggle } from "../lib/kaggle";
import { decodeBridgeDetail, validDeliveryStatus } from "../lib/types";

const activity = { kind: "activity" as const, lines: 1, lineno: 1, cursorpos: 1, language: "Python", dependencies: [], isWrite: false, force: false, lineAdditions: 0, lineDeletions: 0, humanLineChanges: 0 };
const metadata = (owner: string) => ({ owner, slug: "book", title: owner, entity: `/${owner}`, project: owner });

describe("privacy and routing", () => {
  test("parses Kaggle edit metadata", () => expect(parseKaggle("https://www.kaggle.com/code/alice/book/edit", "Book | Kaggle")).toMatchObject({ owner: "alice", project: "Book" }));
  test("rejects non-edit routes", () => expect(parseKaggle("https://www.kaggle.com/code/alice/book", "Book")).toBeNull());
  test("does not mistake an edit-prefixed owner for an edit route", () => expect(parseKaggle("https://www.kaggle.com/code/edit-user/book", "Book")).toBeNull());
  test("sanitizes bridge objects", () => { const decoded = decodeBridgeDetail(JSON.stringify({ ...activity, source: "private" })) as unknown as Record<string, unknown>; expect(decoded.source).toBeUndefined(); expect(decoded).not.toBe(activity); });
  test("relays only sanitized bridge events", async () => {
    const send = vi.fn();
    const remove = installBridgeRelay(document, send);
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: JSON.stringify({ ...activity, source: "private" }) }));
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: "bad" }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]![0]).not.toHaveProperty("source");
    remove();
  });
  test("rejects malformed bridge data", () => { expect(decodeBridgeDetail("no")).toBeNull(); expect(decodeBridgeDetail(JSON.stringify({ ...activity, lines: "1" }))).toBeNull(); });
  test("rejects invalid heartbeat position invariants", () => {
    expect(decodeBridgeDetail(JSON.stringify({ ...activity, lineno: 2, lines: 1 }))).toBeNull();
    expect(decodeBridgeDetail(JSON.stringify({ ...activity, cursorpos: 0 }))).toBeNull();
  });
  test("isolates interleaved tabs", async () => { const map = new Map<string, unknown>(), send = vi.fn(); const handler = createMessageHandler({ get: async key => map.get(key), set: async (key, value) => { map.set(key, value); } }, send); await handler({ kind: "metadata", metadata: metadata("one") }, { tab: { id: 1 } }); await handler({ kind: "metadata", metadata: metadata("two") }, { tab: { id: 2 } }); await handler(activity, { tab: { id: 2 } }); await handler(activity, { tab: { id: 1 } }); expect(send.mock.calls.map(call => call[0].project)).toEqual(["two", "one"]); });
  test("does not send stale metadata after leaving an edit route", async () => {
    const map = new Map<string, unknown>(), send = vi.fn();
    const handler = createMessageHandler({ get: async key => map.get(key), set: async (key, value) => { map.set(key, value); } }, send);
    await handler({ kind: "metadata", metadata: metadata("old") }, { tab: { id: 1 } });
    await handler(activity, { tab: { id: 1, url: "https://www.kaggle.com/code/old/book" } });
    expect(send).not.toHaveBeenCalled();
  });
  test("uses the current edit URL instead of stale stored metadata", async () => {
    const map = new Map<string, unknown>(), send = vi.fn();
    const handler = createMessageHandler({ get: async key => map.get(key), set: async (key, value) => { map.set(key, value); } }, send);
    await handler({ kind: "metadata", metadata: metadata("old") }, { tab: { id: 1 } });
    await handler(activity, { tab: { id: 1, url: "https://www.kaggle.com/code/new-owner/new-book/edit", title: "New Book | Kaggle" } });
    expect(send.mock.calls[0]![0]).toMatchObject({ owner: "new-owner", project: "New Book" });
  });
  test("initializes one stable machine for concurrent callers", async () => {
    let stored: string | undefined;
    const set = vi.fn(async (value: string) => { await Promise.resolve(); stored = value; });
    const machine = createMachineGetter({ get: async () => stored, set }, () => "uuid");
    expect(await Promise.all([machine(), machine(), machine()])).toEqual([
      "kaggle-uuid", "kaggle-uuid", "kaggle-uuid",
    ]);
    expect(set).toHaveBeenCalledOnce();
  });
  test("records that an API key is missing without attempting delivery", async () => {
    const store = vi.fn(), send = vi.fn();
    await deliverActivity(metadata("one"), {
      getSettings: async () => ({ apiKey: "  ", endpoint: "https://example.com/heartbeats" }),
      send, store, failureMessage: () => "failure", now: () => 100,
    });
    expect(send).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith({ state: "not_configured", message: "Add and save a Hackatime API key.", at: 100, entity: "/one" });
  });
  test("records accepted real activity with trimmed settings", async () => {
    const store = vi.fn(), send = vi.fn(async () => true);
    await deliverActivity(metadata("one"), {
      getSettings: async () => ({ apiKey: "  key  ", endpoint: "  https://example.com/heartbeats  " }),
      send, store, failureMessage: () => "failure", now: () => 200,
    });
    expect(send).toHaveBeenCalledWith({ apiKey: "key", endpoint: "https://example.com/heartbeats" });
    expect(store).toHaveBeenCalledWith({ state: "sent", message: "Heartbeat accepted for one.", at: 200, entity: "/one" });
  });
  test("records safe delivery failures without rejecting the message handler", async () => {
    const store = vi.fn();
    await expect(deliverActivity(metadata("one"), {
      getSettings: async () => ({ apiKey: "key", endpoint: "https://example.com/heartbeats" }),
      send: async () => { throw new Error("secret internals"); },
      store, failureMessage: () => "The heartbeat endpoint could not be reached.", now: () => 300,
    })).resolves.toBeUndefined();
    expect(store).toHaveBeenCalledWith({ state: "failed", message: "The heartbeat endpoint could not be reached.", at: 300, entity: "/one" });
    expect(JSON.stringify(store.mock.calls)).not.toContain("secret internals");
  });
  test("accepts only safe complete stored delivery status", () => {
    expect(validDeliveryStatus({ state: "sent", message: "Accepted", at: 100, entity: "/one" })).toBe(true);
    expect(validDeliveryStatus({ state: "unknown", message: "Accepted", at: 100 })).toBe(false);
    expect(validDeliveryStatus({ state: "failed", message: "", at: 100 })).toBe(false);
    expect(validDeliveryStatus({ state: "failed", message: "Failed", at: "now" })).toBe(false);
    expect(validDeliveryStatus({ state: "failed", message: "Failed", at: 100, entity: 42 })).toBe(false);
  });
});
