import { DEFAULT_ENDPOINT } from "./heartbeat";

export interface OptionsAdapter {
  load(): Promise<{ apiKey?: unknown; endpoint?: unknown }>;
  save(values: { apiKey: string; endpoint: string }): Promise<void>;
  requestOrigin(origin: string): Promise<boolean>;
}

export const OPTIONS_MARKUP = `
  <h1>Hackatime for Kaggle Notebooks</h1>
  <form>
    <label for="api-key">API key</label>
    <input id="api-key" name="apiKey" type="password" autocomplete="off" required>
    <label for="endpoint">API endpoint</label>
    <input id="endpoint" name="endpoint" type="url" required>
    <button type="submit">Save</button>
    <p id="status" role="status" aria-live="polite"></p>
  </form>
`;

export async function mountOptions(root: HTMLElement, adapter: OptionsAdapter) {
  root.innerHTML = OPTIONS_MARKUP;
  const form = root.querySelector<HTMLFormElement>("form")!;
  const key = root.querySelector<HTMLInputElement>("#api-key")!;
  const endpoint = root.querySelector<HTMLInputElement>("#endpoint")!;
  const status = root.querySelector<HTMLElement>("#status")!;
  const values = await adapter.load();
  key.value = String(values.apiKey ?? ""); endpoint.value = String(values.endpoint ?? DEFAULT_ENDPOINT);
  form.addEventListener("submit", async event => {
    event.preventDefault(); status.textContent = "";
    let url: URL;
    try { url = new URL(endpoint.value); } catch { endpoint.setCustomValidity("Enter a valid URL"); endpoint.reportValidity(); return; }
    if (url.protocol !== "https:") { endpoint.setCustomValidity("Use an HTTPS endpoint"); endpoint.reportValidity(); return; }
    endpoint.setCustomValidity("");
    if (!await adapter.requestOrigin(`${url.origin}/*`)) { status.textContent = "Permission denied. Allow access to this endpoint to save."; return; }
    await adapter.save({ apiKey: key.value, endpoint: url.href });
    status.textContent = "Settings saved";
  });
}
