import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@fontsource-variable/spline-sans";
import "../entrypoints/options/style.css";
import { mountOptions } from "../lib/options";

describe("options", () => {
  let root: HTMLElement;
  beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; root = document.querySelector("#app")!; });
  test("loads saved values into a password field", async () => { await mountOptions(root, { load: async () => ({ apiKey: "old", endpoint: "https://saved.test/h" }), save: vi.fn(), requestOrigin: async () => true }); expect(page.getByLabelText("API key")).toHaveAttribute("type", "password"); await expect.element(page.getByLabelText("API endpoint")).toHaveValue("https://saved.test/h"); });
  test("saves values through real interactions", async () => { const save = vi.fn(), requestOrigin = vi.fn(async () => true); await mountOptions(root, { load: async () => ({}), save, requestOrigin }); await page.getByLabelText("API key").fill("new-key"); await page.getByLabelText("API endpoint").fill("https://custom.test/api"); await page.getByRole("button").click(); await expect.element(page.getByRole("status")).toHaveTextContent("Settings saved"); expect(requestOrigin).toHaveBeenCalledWith("https://custom.test/*"); expect(save).toHaveBeenCalledWith({ apiKey: "new-key", endpoint: "https://custom.test/api" }); });
  test("rejects non-HTTPS URLs", async () => { const save = vi.fn(); await mountOptions(root, { load: async () => ({}), save, requestOrigin: async () => true }); await page.getByLabelText("API key").fill("key"); await page.getByLabelText("API endpoint").fill("http://unsafe.test"); await page.getByRole("button").click(); expect(save).not.toHaveBeenCalled(); expect((document.querySelector("#endpoint") as HTMLInputElement).validationMessage).toContain("HTTPS"); });
  test("reports optional permission denial", async () => { const save = vi.fn(); await mountOptions(root, { load: async () => ({}), save, requestOrigin: async () => false }); await page.getByLabelText("API key").fill("key"); await page.getByLabelText("API endpoint").fill("https://denied.test/api"); await page.getByRole("button").click(); await expect.element(page.getByRole("status")).toHaveTextContent("Permission denied"); expect(save).not.toHaveBeenCalled(); });
  test("submits with the keyboard", async () => {
    const save = vi.fn();
    await mountOptions(root, { load: async () => ({}), save, requestOrigin: async () => true });
    await page.getByLabelText("API key").fill("keyboard-key");
    await page.getByLabelText("API endpoint").fill("https://keyboard.test/api");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("status")).toHaveTextContent("Settings saved");
    expect(save).toHaveBeenCalledOnce();
  });
  test("uses Spline Sans, Dracula, square controls and no gradients", async () => { await mountOptions(root, { load: async () => ({}), save: vi.fn(), requestOrigin: async () => true }); const pageStyle = getComputedStyle(document.documentElement), input = getComputedStyle(document.querySelector("input")!), button = getComputedStyle(document.querySelector("button")!); expect(pageStyle.fontFamily).toContain("Spline Sans"); expect(pageStyle.backgroundColor).toBe("rgb(40, 42, 54)"); expect(input.borderRadius).toBe("0px"); expect(button.backgroundImage).toBe("none"); });
});
