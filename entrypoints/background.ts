import { createMachineGetter, createMessageHandler } from "../lib/background";
import { DEFAULT_ENDPOINT, submit } from "../lib/heartbeat";

const local = browser.storage.local;
const session = browser.storage.session;

export default defineBackground(() => {
  const machine = createMachineGetter({
    get: async () => (await local.get("machine")).machine,
    set: async value => { await local.set({ machine: value }); },
  });
  const handler = createMessageHandler({
    get: async key => (await session?.get(key))?.[key],
    set: async (key, value) => { await session?.set({ [key]: value }); },
  }, async (metadata, activity) => {
    const settings = await local.get(["apiKey", "endpoint"]);
    if (!settings.apiKey) return;
    try {
      await submit(metadata, activity, {
        apiKey: String(settings.apiKey), endpoint: String(settings.endpoint || DEFAULT_ENDPOINT), machine: await machine(),
      }, {
        now: () => Date.now() / 1000, fetch,
        getLast: async entity => Number((await session?.get(`last:${entity}`))?.[`last:${entity}`] ?? (await local.get(`last:${entity}`))[`last:${entity}`] ?? 0),
        setLast: async (entity, time) => { const item = { [`last:${entity}`]: time }; await session?.set(item); await local.set(item); },
      });
    } catch { console.warn("Hackatime for Kaggle Notebooks heartbeat request failed"); }
  });
  browser.runtime.onMessage.addListener(handler);
});
