import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { loadEnv } from "vite";
import { createRealKaggleCommand } from "./tests/support/real-kaggle.ts";

const extensionPath = resolve(".output/chrome-mv3");
const profilePath = resolve(".wxt/vitest-kaggle-profile");
const defaultNotebookUrl = "https://www.kaggle.com/code/mahadkalam/notebookc5f95ffa1f/edit";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  if (!env.KAGGLE) throw new Error("KAGGLE must be set to run the real Kaggle browser suite");
  rmSync(profilePath, { force: true, recursive: true });
  process.once("exit", () => rmSync(profilePath, { force: true, recursive: true }));

  return {
    test: {
      include: ["tests/**/*.test.ts"],
      fileParallelism: false,
      browser: {
        enabled: true,
        provider: playwright({
          persistentContext: profilePath,
          launchOptions: {
            channel: "chromium",
            args: [
              `--disable-extensions-except=${extensionPath}`,
              `--load-extension=${extensionPath}`,
              "--host-resolver-rules=MAP hackatime.hackclub.com 127.0.0.1, MAP api.wakatime.com 127.0.0.1",
              "--ignore-certificate-errors",
            ],
          },
        }),
        commands: {
          realKaggle: createRealKaggleCommand({
            cookie: env.KAGGLE,
            notebookUrl: env.KAGGLE_NOTEBOOK_URL || defaultNotebookUrl,
            hackatimeUrl: env.HACKATIME_TEST_URL,
            apiKey: env.HACKATIME_TEST_API_KEY || "real-kaggle-browser-test-key",
            requireHackatime: env.CI === "true",
          }),
        },
        headless: true,
        instances: [{ browser: "chromium" }],
      },
    },
  };
});
