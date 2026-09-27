import {
  createDefaultHomeLayout,
  REQUIRED_HOME_LAYOUT_SECTION_IDS,
  type HomeLayout,
  type HomeLayoutState,
} from "@fan-support/contracts";
export type SectionId = HomeLayout["sections"][number]["id"];
export function editableLayout(state: HomeLayoutState): HomeLayout {
  return (
    state.draft?.layout ?? state.published?.layout ?? createDefaultHomeLayout()
  );
}
export function sameLayout(left: HomeLayout, right: HomeLayout): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
export function requiredSection(id: SectionId): boolean {
  return REQUIRED_HOME_LAYOUT_SECTION_IDS.some((required) => required === id);
}
export function moveSection(
  layout: HomeLayout,
  id: SectionId,
  direction: -1 | 1,
): HomeLayout {
  const index = layout.sections.findIndex((section) => section.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= layout.sections.length)
    return layout;
  const sections = [...layout.sections];
  const moved = sections.splice(index, 1)[0];
  if (!moved) return layout;
  sections.splice(destination, 0, moved);
  return { ...layout, sections };
}
export function setSectionVisible(
  layout: HomeLayout,
  id: SectionId,
  visible: boolean,
): HomeLayout {
  if (!visible && requiredSection(id)) return layout;
  return {
    ...layout,
    sections: layout.sections.map((section) =>
      section.id === id ? { ...section, visible } : section,
    ),
  };
}
