import "@fontsource-variable/spline-sans";
import "./style.css";
import { mountOptions } from "../../lib/options";

void mountOptions(document.querySelector<HTMLElement>("#app")!, {
  load: () => browser.storage.local.get(["apiKey", "endpoint"]),
  save: values => browser.storage.local.set(values),
  requestOrigin: origin => browser.permissions.request({ origins: [origin] }),
});
