import { DEFAULT_ENDPOINT } from "./heartbeat";
import { validDeliveryStatus, type DeliveryStatus } from "./types";

export interface OptionsAdapter {
  load(): Promise<{ apiKey?: unknown; endpoint?: unknown; deliveryStatus?: unknown }>;
  save(values: { apiKey: string; endpoint: string }): Promise<void>;
  requestOrigin(origin: string): Promise<boolean>;
  test(values: { apiKey: string; endpoint: string }): Promise<DeliveryStatus>;
  watchDelivery?(listener: (delivery: unknown) => void): () => void;
}

export const OPTIONS_MARKUP = `
  <h1>Hackatime for Kaggle Notebooks</h1>
  <form>
    <label for="api-key">API key</label>
    <input id="api-key" name="apiKey" type="password" autocomplete="off" required>
    <label for="endpoint">API endpoint</label>
    <input id="endpoint" name="endpoint" type="url" required>
    <div class="actions">
      <button type="submit">Save</button>
      <button id="test-connection" type="button">Save and test</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
  </form>
  <section class="delivery" aria-labelledby="delivery-heading">
    <h2 id="delivery-heading">Delivery status</h2>
    <p id="delivery-status" aria-live="polite">No heartbeat attempted yet.</p>
  </section>
`;

function renderDelivery(element: HTMLElement, delivery: DeliveryStatus) {
  const when = new Date(delivery.at).toLocaleString();
  element.textContent = `${delivery.message}${delivery.entity ? ` ${delivery.entity}` : ""} ${when}`;
  element.dataset.state = delivery.state;
}

export async function mountOptions(root: HTMLElement, adapter: OptionsAdapter) {
  root.innerHTML = OPTIONS_MARKUP;
  const form = root.querySelector<HTMLFormElement>("form")!;
  const key = root.querySelector<HTMLInputElement>("#api-key")!;
  const endpoint = root.querySelector<HTMLInputElement>("#endpoint")!;
  const status = root.querySelector<HTMLElement>("#status")!;
  const testConnection = root.querySelector<HTMLButtonElement>("#test-connection")!;
  const deliveryStatus = root.querySelector<HTMLElement>("#delivery-status")!;
  const values = await adapter.load();
  key.value = String(values.apiKey ?? ""); endpoint.value = String(values.endpoint ?? DEFAULT_ENDPOINT);
  if (validDeliveryStatus(values.deliveryStatus)) renderDelivery(deliveryStatus, values.deliveryStatus);
  const stopWatching = adapter.watchDelivery?.(delivery => {
    if (validDeliveryStatus(delivery)) renderDelivery(deliveryStatus, delivery);
  });

  const save = async () => {
    status.textContent = "";
    const apiKey = key.value.trim();
    if (!apiKey) { key.setCustomValidity("Enter an API key"); key.reportValidity(); return null; }
    key.setCustomValidity("");
    let url: URL;
    try { url = new URL(endpoint.value.trim()); } catch { endpoint.setCustomValidity("Enter a valid URL"); endpoint.reportValidity(); return null; }
    if (url.protocol !== "https:") { endpoint.setCustomValidity("Use an HTTPS endpoint"); endpoint.reportValidity(); return null; }
    endpoint.setCustomValidity("");
    if (!await adapter.requestOrigin(`${url.origin}/*`)) { status.textContent = "Permission denied. Allow access to this endpoint to save."; return null; }
    const saved = { apiKey, endpoint: url.href };
    key.value = apiKey; endpoint.value = url.href;
    await adapter.save(saved);
    return saved;
  };

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!await save()) return;
    status.textContent = "Settings saved";
  });

  testConnection.addEventListener("click", async () => {
    const saved = await save();
    if (!saved) return;
    testConnection.disabled = true;
    status.textContent = "Sending test heartbeat";
    try {
      const delivery = await adapter.test(saved);
      status.textContent = delivery.state === "sent" ? "Connection test passed" : delivery.message;
    } finally {
      testConnection.disabled = false;
    }
  });
  return () => stopWatching?.();
}
