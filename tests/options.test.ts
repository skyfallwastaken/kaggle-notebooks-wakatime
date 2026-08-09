import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@fontsource-variable/spline-sans";
import "../entrypoints/options/style.css";
import { mountOptions, type OptionsAdapter } from "../lib/options";
import type { DeliveryStatus } from "../lib/types";

const sent: DeliveryStatus = { state: "sent", message: "Test heartbeat accepted by the endpoint.", at: 1_700_000_000_000, entity: "test.txt" };
function optionsAdapter(overrides: Partial<OptionsAdapter> = {}): OptionsAdapter {
  return {
    load: async () => ({}),
    save: async () => {},
    requestOrigin: async () => true,
    test: async () => sent,
    ...overrides,
  };
}

describe("options", () => {
  let root: HTMLElement;
  beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; root = document.querySelector("#app")!; });
  test("loads saved values and delivery status", async () => {
    await mountOptions(root, optionsAdapter({ load: async () => ({ apiKey: "old", endpoint: "https://saved.test/h", deliveryStatus: sent }) }));
    expect(page.getByLabelText("API key")).toHaveAttribute("type", "password");
    await expect.element(page.getByLabelText("API endpoint")).toHaveValue("https://saved.test/h");
    await expect.element(page.getByText(/Test heartbeat accepted by the endpoint/)).toBeVisible();
  });
  test("trims and saves values through real interactions", async () => {
    const save = vi.fn(), requestOrigin = vi.fn(async () => true);
    await mountOptions(root, optionsAdapter({ save, requestOrigin }));
    await page.getByLabelText("API key").fill("  new-key  ");
    await page.getByLabelText("API endpoint").fill("  https://custom.test/api  ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Settings saved");
    expect(requestOrigin).toHaveBeenCalledWith("https://custom.test/*");
    expect(save).toHaveBeenCalledWith({ apiKey: "new-key", endpoint: "https://custom.test/api" });
  });
  test("rejects non-HTTPS URLs", async () => {
    const save = vi.fn();
    await mountOptions(root, optionsAdapter({ save }));
    await page.getByLabelText("API key").fill("key");
    await page.getByLabelText("API endpoint").fill("http://unsafe.test");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(save).not.toHaveBeenCalled();
    expect((document.querySelector("#endpoint") as HTMLInputElement).validationMessage).toContain("HTTPS");
  });
  test("refuses to save or test when optional permission is denied", async () => {
    const save = vi.fn(), testConnection = vi.fn(async () => sent);
    await mountOptions(root, optionsAdapter({ save, requestOrigin: async () => false, test: testConnection }));
    await page.getByLabelText("API key").fill("key");
    await page.getByLabelText("API endpoint").fill("https://denied.test/api");
    await page.getByRole("button", { name: "Save and test" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Permission denied");
    expect(save).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
  });
  test("saves, sends a test heartbeat and renders success", async () => {
    const save = vi.fn(), testConnection = vi.fn(async () => sent);
    await mountOptions(root, optionsAdapter({ save, test: testConnection }));
    await page.getByLabelText("API key").fill("  test-key  ");
    await page.getByLabelText("API endpoint").fill("https://custom.test/heartbeats");
    await page.getByRole("button", { name: "Save and test" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Connection test passed");
    expect(save).toHaveBeenCalledBefore(testConnection);
    expect(testConnection).toHaveBeenCalledWith({ apiKey: "test-key", endpoint: "https://custom.test/heartbeats" });
  });
  test("does not replace real edit status with a connection test", async () => {
    const editFailure: DeliveryStatus = { state: "failed", message: "The last Kaggle edit was rejected.", at: Date.now(), entity: "/one.ipynb" };
    await mountOptions(root, optionsAdapter({ load: async () => ({ apiKey: "key", endpoint: "https://custom.test/heartbeats", deliveryStatus: editFailure }) }));
    await page.getByRole("button", { name: "Save and test" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Connection test passed");
    await expect.element(page.getByText(/The last Kaggle edit was rejected/)).toBeVisible();
  });
  test.each([
    "The heartbeat endpoint rejected the API key.",
    "The heartbeat endpoint timed out.",
    "The heartbeat endpoint could not be reached.",
  ])("renders connection failure: %s", async message => {
    await mountOptions(root, optionsAdapter({ test: async () => ({ state: "failed", message, at: Date.now(), entity: "test.txt" }) }));
    await page.getByLabelText("API key").fill("never-show-this-key");
    await page.getByRole("button", { name: "Save and test" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent(message);
    expect(root.textContent).not.toContain("never-show-this-key");
  });
  test("updates when the background worker records a delivery", async () => {
    let notify: ((delivery: unknown) => void) | undefined;
    const stop = vi.fn();
    const unmount = await mountOptions(root, optionsAdapter({ watchDelivery: listener => { notify = listener; return stop; } }));
    notify?.({ state: "failed", message: "The heartbeat endpoint rejected the API key.", at: Date.now(), entity: "/kaggle/notebooks/example.ipynb" });
    await expect.element(page.getByText(/rejected the API key/)).toBeVisible();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });
  test("submits with the keyboard", async () => {
    const save = vi.fn();
    await mountOptions(root, optionsAdapter({ save }));
    await page.getByLabelText("API key").fill("keyboard-key");
    await page.getByLabelText("API endpoint").fill("https://keyboard.test/api");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("status")).toHaveTextContent("Settings saved");
    expect(save).toHaveBeenCalledOnce();
  });
  test("uses Spline Sans, Dracula, square controls and no gradients", async () => { await mountOptions(root, optionsAdapter()); const pageStyle = getComputedStyle(document.documentElement), input = getComputedStyle(document.querySelector("input")!), button = getComputedStyle(document.querySelector("button")!); expect(pageStyle.fontFamily).toContain("Spline Sans"); expect(pageStyle.backgroundColor).toBe("rgb(40, 42, 54)"); expect(input.borderRadius).toBe("0px"); expect(button.backgroundImage).toBe("none"); });
});
