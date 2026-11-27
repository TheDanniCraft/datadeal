import { publisherScript } from "./publisher-tag";

type Slot = { addService(service: unknown): Slot };
type SlotRenderListener = (event: { slot: Slot; isEmpty: boolean }) => void;
type PublisherAds = {
  addEventListener(type: "slotRenderEnded", listener: SlotRenderListener): void;
  removeEventListener(
    type: "slotRenderEnded",
    listener: SlotRenderListener,
  ): void;
};
type Gpt = {
  cmd: { push(callback: () => void): unknown };
  apiReady?: boolean;
  defineSlot(
    path: string,
    size: [number, number] | [number, number][],
    id: string,
  ): Slot | null;
  pubads(): PublisherAds;
  enableServices(): void;
  display(slot: Slot): void;
  destroySlots(slots: Slot[]): boolean;
};

export type DisplayAdFailure = "load_failed" | "unavailable";

export function mountGoogleDisplayAd(
  element: HTMLElement,
  path: string,
  onUnavailable: (reason: DisplayAdFailure) => void,
  format: "banner" | "rail" = "banner",
) {
  const scope = window as Window & { googletag?: Gpt };
  const tag = scope.googletag ?? ({ cmd: [] } as unknown as Gpt);
  scope.googletag = tag;
  let slot: Slot | null = null;
  let publisher: PublisherAds | undefined;
  let active = true;
  const script = publisherScript();
  const fail = (reason: DisplayAdFailure) => {
    if (!active) return;
    active = false;
    onUnavailable(reason);
  };
  const unavailable = () => fail("unavailable");
  const loadFailed = () => fail("load_failed");
  const deadline = window.setTimeout(unavailable, 5000);
  const onRender: SlotRenderListener = (event) => {
    if (!active || event.slot !== slot) return;
    clearTimeout(deadline);
    if (event.isEmpty) unavailable();
  };

  tag.cmd.push(() => {
    if (!active || !element.isConnected) return;
    const width = element.clientWidth;
    if (width < (format === "rail" ? 120 : 300)) {
      unavailable();
      return;
    }
    publisher = tag.pubads();
    slot = tag.defineSlot(
      path,
      format === "rail"
        ? width >= 160
          ? [160, 600]
          : [120, 600]
        : // In-page placements are a slim horizontal strip, never a block.
          width >= 728
          ? [728, 90]
          : [
              [320, 100],
              [320, 50],
              [300, 50],
            ],
      element.id,
    );
    if (!slot) {
      unavailable();
      return;
    }
    publisher.addEventListener("slotRenderEnded", onRender);
    slot.addService(publisher);
    tag.enableServices();
    tag.display(slot);
  });

  if (!tag.apiReady) {
    script.addEventListener("error", loadFailed, { once: true });
    if (!script.isConnected) document.head.append(script);
  }
  return () => {
    active = false;
    clearTimeout(deadline);
    script.removeEventListener("error", loadFailed);
    publisher?.removeEventListener("slotRenderEnded", onRender);
    if (slot) tag.destroySlots([slot]);
  };
}
