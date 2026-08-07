import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Kaggle Notebooks WakaTime",
    description: "Send privacy-conscious Kaggle notebook coding heartbeats.",
    version: "0.1.0",
    permissions: ["storage"],
    host_permissions: [
      "https://www.kaggle.com/code/*",
      "https://*.jupyter-proxy.kaggle.net/*",
      "https://hackatime.hackclub.com/*",
      "https://api.wakatime.com/*"
    ],
    optional_host_permissions: ["https://*/*"]
  }
});
