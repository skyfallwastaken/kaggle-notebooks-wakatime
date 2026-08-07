import { parseKaggle } from "../lib/kaggle";
export default defineContentScript({ matches: ["https://www.kaggle.com/code/*"], runAt: "document_idle", main(ctx) {
  let previous = "";
  const send = () => { const metadata = parseKaggle(location.href, document.title); const serialized = JSON.stringify(metadata); if (metadata && serialized !== previous) { previous = serialized; void browser.runtime.sendMessage({ kind: "metadata", metadata }); } };
  send();
  const title = document.querySelector("title");
  if (title) new MutationObserver(send).observe(title, { childList: true, characterData: true, subtree: true });
  ctx.addEventListener(window, "wxt:locationchange", () => {
    previous = "";
    send();
  });
} });
