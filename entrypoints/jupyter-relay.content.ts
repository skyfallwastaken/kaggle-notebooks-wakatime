import { installBridgeRelay } from "../lib/bridge";
export default defineContentScript({ matches: ["https://*.jupyter-proxy.kaggle.net/*"], allFrames: true, runAt: "document_start", main() {
  installBridgeRelay(document, activity => browser.runtime.sendMessage(activity));
} });
