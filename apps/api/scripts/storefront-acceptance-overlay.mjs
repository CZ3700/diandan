/** Observe actual painted hit targets, not only DOM order or computed z-index. */
export async function observeAcceptanceOverlayStacking(page) {
  return page.getByRole("dialog").evaluate((dialog) => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
      };
    };
    const header = globalThis.document.querySelector(".storefront-header");
    return {
      schemaVersion: 1,
      backgroundHeader: header ? rect(header) : null,
      targets: ["title", "description", "close"].map((name) => {
        const element = dialog.querySelector(`.fs-overlay__${name}`);
        if (!element) return { name, present: false, points: [] };
        const bounds = rect(element);
        const points = [0.2, 0.5, 0.8].map((fraction) => {
          const x = bounds.x + bounds.width / 2;
          const y = bounds.y + bounds.height * fraction;
          const hit = globalThis.document.elementFromPoint(x, y);
          return {
            x,
            y,
            visible:
              x >= 0 &&
              x < globalThis.innerWidth &&
              y >= 0 &&
              y < globalThis.innerHeight,
            targetReceivesHit: hit === element || element.contains(hit),
            backgroundHeaderReceivesHit: Boolean(
              header && (hit === header || header.contains(hit)),
            ),
            hitTag: hit?.tagName ?? null,
          };
        });
        return { name, present: true, bounds, points };
      }),
    };
  });
}

export function verifyAcceptanceOverlayStacking(observation, check) {
  check(
    observation.backgroundHeader !== null,
    "overlay stacking is measured against the actual storefront header",
  );
  for (const target of observation.targets) {
    check(
      target.present && target.points.length === 3,
      `open overlay ${target.name} has three actual painted hit samples`,
    );
    for (const point of target.points)
      check(
        point.visible &&
          point.targetReceivesHit &&
          !point.backgroundHeaderReceivesHit,
        `open overlay ${target.name} is visible above the background sticky header`,
      );
  }
}
