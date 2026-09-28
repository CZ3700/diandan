import {
  createDefaultStorefrontNavigation,
  type StorefrontNavigation,
  type StorefrontNavigationState,
} from "@fan-support/contracts";
export function editableNavigation(
  state: StorefrontNavigationState,
): StorefrontNavigation {
  return (
    state.draft?.navigation ??
    state.published?.navigation ??
    createDefaultStorefrontNavigation()
  );
}
export function sameNavigation(
  left: StorefrontNavigation,
  right: StorefrontNavigation,
): boolean {
  return (
    left.header.length === right.header.length &&
    left.header.every((id, index) => id === right.header[index]) &&
    left.footer.length === right.footer.length &&
    left.footer.every(
      (item, index) =>
        item.id === right.footer[index]?.id &&
        item.visible === right.footer[index]?.visible,
    )
  );
}
export function moveNavigationItem(
  navigation: StorefrontNavigation,
  section: "header" | "footer",
  id:
    | StorefrontNavigation["header"][number]
    | StorefrontNavigation["footer"][number]["id"],
  direction: -1 | 1,
): StorefrontNavigation {
  const ids =
    section === "header"
      ? navigation.header
      : navigation.footer.map((item) => item.id);
  const index = ids.findIndex((value) => value === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return navigation;
  if (section === "header") {
    const header = [...navigation.header];
    const [item] = header.splice(index, 1);
    if (!item) return navigation;
    header.splice(target, 0, item);
    return { ...navigation, header };
  }
  const footer = [...navigation.footer];
  const [item] = footer.splice(index, 1);
  if (!item) return navigation;
  footer.splice(target, 0, item);
  return { ...navigation, footer };
}
export function setNavigationFooterVisible(
  navigation: StorefrontNavigation,
  id: StorefrontNavigation["footer"][number]["id"],
  visible: boolean,
): StorefrontNavigation {
  if (id === "POLICIES") return navigation;
  return {
    ...navigation,
    footer: navigation.footer.map((item) =>
      item.id === id ? { ...item, visible } : item,
    ),
  };
}
