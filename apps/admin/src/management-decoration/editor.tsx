import { Button, Icon } from "@fan-support/ui";
import type { HomeLayout } from "@fan-support/contracts";
import { moveSection, setSectionVisible, requiredSection } from "./model";
import type { DecorationCopy } from "./copy";

export function LayoutSectionEditor({
  layout,
  onChange,
  disabled,
  copy,
}: {
  layout: HomeLayout;
  onChange: (layout: HomeLayout) => void;
  disabled: boolean;
  copy: DecorationCopy;
}) {
  return (
    <section aria-labelledby="layout-sections-title">
      <h2 id="layout-sections-title">{copy.sectionTitle}</h2>
      <ol className="decoration-sections" data-layout-sections>
        {layout.sections.map((section, index) => (
          <li
            key={section.id}
            data-layout-section={section.id}
            data-visible={section.visible}
          >
            <span className="decoration-section-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="decoration-section-name">
              <strong>{copy.sections[section.id]}</strong>
              <label>
                <input
                  type="checkbox"
                  data-layout-visible={section.id}
                  checked={section.visible}
                  disabled={disabled || requiredSection(section.id)}
                  onChange={(event) =>
                    onChange(
                      setSectionVisible(
                        layout,
                        section.id,
                        event.currentTarget.checked,
                      ),
                    )
                  }
                />
                {requiredSection(section.id) ? copy.required : copy.shown}
              </label>
            </div>
            <div className="decoration-section-move">
              <Button
                type="button"
                variant="quiet"
                data-layout-up={section.id}
                disabled={disabled || index === 0}
                aria-label={`${copy.moveUp}: ${copy.sections[section.id]}`}
                onClick={() => onChange(moveSection(layout, section.id, -1))}
              >
                <Icon
                  name="chevron-down"
                  className="decoration-up-icon"
                  decorative
                />
              </Button>
              <Button
                type="button"
                variant="quiet"
                data-layout-down={section.id}
                disabled={disabled || index === layout.sections.length - 1}
                aria-label={`${copy.moveDown}: ${copy.sections[section.id]}`}
                onClick={() => onChange(moveSection(layout, section.id, 1))}
              >
                <Icon name="chevron-down" decorative />
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
