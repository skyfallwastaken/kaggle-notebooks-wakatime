import { parseKaggle } from "./kaggle";
import { validActivity, validMetadata, type DeliveryStatus, type ExtensionMessage, type NotebookMetadata } from "./types";

export interface MetadataStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: NotebookMetadata): Promise<void>;
}

export interface MachineStore {
  get(): Promise<unknown>;
  set(value: string): Promise<void>;
}

export interface DeliveryBoundaries {
  getSettings(): Promise<{ apiKey: string; endpoint: string }>;
  send(settings: { apiKey: string; endpoint: string }): Promise<boolean>;
  store(status: DeliveryStatus): Promise<void>;
  failureMessage(error: unknown): string;
  now(): number;
}

export async function deliverActivity(metadata: NotebookMetadata, boundaries: DeliveryBoundaries) {
  const settings = await boundaries.getSettings();
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    await boundaries.store({ state: "not_configured", message: "Add and save a Hackatime API key.", at: boundaries.now(), entity: metadata.entity });
    return;
  }
  try {
    const sent = await boundaries.send({ apiKey, endpoint: settings.endpoint.trim() });
    if (sent) await boundaries.store({ state: "sent", message: `Heartbeat accepted for ${metadata.project}.`, at: boundaries.now(), entity: metadata.entity });
  } catch (error) {
    await boundaries.store({ state: "failed", message: boundaries.failureMessage(error), at: boundaries.now(), entity: metadata.entity });
  }
}

export function createMachineGetter(
  store: MachineStore,
  uuid: () => string = () => crypto.randomUUID(),
) {
  let pending: Promise<string> | undefined;
  return () => {
    pending ??= (async () => {
      const stored = await store.get();
      if (typeof stored === "string" && stored.length > 0) return stored;
      const value = `kaggle-${uuid()}`;
      await store.set(value);
      return value;
    })().catch(error => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

export function createMessageHandler(store: MetadataStore, send: (metadata: NotebookMetadata, activity: ExtensionMessage & { kind: "activity" }) => Promise<void>) {
  return async (message: unknown, sender: { tab?: { id?: number; url?: string; title?: string } }) => {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) return;
    const key = `metadata:${tabId}`;
    if (message && typeof message === "object" && (message as { kind?: unknown }).kind === "metadata") {
      const metadata = (message as { metadata?: unknown }).metadata;
      if (validMetadata(metadata)) await store.set(key, metadata);
      return;
    }
    if (!validActivity(message)) return;

    const stored = await store.get(key);
    let metadata: unknown = stored;
    if (sender.tab?.url) {
      const current = parseKaggle(sender.tab.url, sender.tab.title ?? "");
      if (!current) return;
      if (!validMetadata(stored) || stored.entity !== current.entity) {
        metadata = current;
        await store.set(key, current);
      }
    }
    if (validMetadata(metadata)) await send(metadata, message);
  };
}
