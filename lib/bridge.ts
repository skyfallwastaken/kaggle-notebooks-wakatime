import { decodeBridgeDetail, type Activity } from "./types";

export const BRIDGE_EVENT = "kaggle-wakatime:activity";

export function installBridgeRelay(
  target: Document,
  send: (activity: Activity) => void | Promise<void>,
): () => void {
  const handle = (event: Event) => {
    const activity = decodeBridgeDetail((event as CustomEvent).detail);
    if (activity) void send(activity);
  };
  target.addEventListener(BRIDGE_EVENT, handle);
  return () => target.removeEventListener(BRIDGE_EVENT, handle);
}
