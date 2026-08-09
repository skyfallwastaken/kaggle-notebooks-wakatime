import { createMachineGetter, createMessageHandler, deliverActivity } from "../lib/background";
import { DEFAULT_ENDPOINT, heartbeatFailureMessage, submit } from "../lib/heartbeat";
import type { Activity, NotebookMetadata } from "../lib/types";

const local = browser.storage.local;
const session = browser.storage.session;

export default defineBackground(() => {
  const machine = createMachineGetter({
    get: async () => (await local.get("machine")).machine,
    set: async value => { await local.set({ machine: value }); },
  });
  const send = async (metadata: NotebookMetadata, activity: Activity) => {
    await deliverActivity(metadata, {
      getSettings: async () => {
        const settings = await local.get(["apiKey", "endpoint"]);
        return { apiKey: String(settings.apiKey ?? ""), endpoint: String(settings.endpoint || DEFAULT_ENDPOINT) };
      },
      send: async settings => submit(metadata, activity, {
        ...settings, machine: await machine(),
      }, {
        now: () => Date.now() / 1000, fetch,
        getLast: async entity => Number((await session?.get(`last:${entity}`))?.[`last:${entity}`] ?? (await local.get(`last:${entity}`))[`last:${entity}`] ?? 0),
        setLast: async (entity, time) => { const item = { [`last:${entity}`]: time }; await session?.set(item); await local.set(item); },
      }),
      store: async deliveryStatus => { await local.set({ deliveryStatus }); },
      failureMessage: heartbeatFailureMessage,
      now: Date.now,
    });
  };
  const handler = createMessageHandler({
    get: async key => (await session?.get(key))?.[key],
    set: async (key, value) => { await session?.set({ [key]: value }); },
  }, send);
  browser.runtime.onMessage.addListener(handler);
});
