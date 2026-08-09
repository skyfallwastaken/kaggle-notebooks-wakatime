import "@fontsource-variable/spline-sans";
import "./style.css";
import { mountOptions } from "../../lib/options";
import { heartbeatFailureMessage, testHeartbeatConnection } from "../../lib/heartbeat";
import type { DeliveryStatus } from "../../lib/types";

const local = browser.storage.local;

void mountOptions(document.querySelector<HTMLElement>("#app")!, {
  load: () => local.get(["apiKey", "endpoint", "deliveryStatus"]),
  save: values => local.set(values),
  requestOrigin: origin => browser.permissions.request({ origins: [origin] }),
  watchDelivery: listener => {
    const handleChange = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.deliveryStatus) listener(changes.deliveryStatus.newValue);
    };
    browser.storage.onChanged.addListener(handleChange);
    return () => browser.storage.onChanged.removeListener(handleChange);
  },
  test: async values => {
    try {
      await testHeartbeatConnection(values);
      return { state: "sent", message: "Test heartbeat accepted by the endpoint.", at: Date.now(), entity: "test.txt" } satisfies DeliveryStatus;
    } catch (error) {
      return { state: "failed", message: heartbeatFailureMessage(error), at: Date.now(), entity: "test.txt" } satisfies DeliveryStatus;
    }
  },
});
