import { Button, Icon } from "@fan-support/ui";
import type { StorefrontNavigation } from "@fan-support/contracts";
import {
  moveNavigationItem,
  setNavigationFooterVisible,
} from "./navigation-model";
import type { NavigationCopy } from "./navigation-copy";
export function NavigationEditor({
  navigation,
  onChange,
  disabled,
  copy,
}: {
  navigation: StorefrontNavigation;
  onChange: (navigation: StorefrontNavigation) => void;
  disabled: boolean;
  copy: NavigationCopy;
}) {
  return (
    <div data-navigation-editor>
      <p className="mc-hint">{copy.fixedControlsHint}</p>
      {(["header", "footer"] as const).map((section) => {
        const rows =
          section === "header"
            ? navigation.header.map((id) => ({
                id,
                label: copy.headerLabels[id],
                visible: true,
              }))
            : navigation.footer
                .filter((item) => item.id !== "DESCRIPTION")
                .map((item) => ({
                  ...item,
                  label: copy.footerLabels[item.id],
                }));
        return (
          <section
            key={section}
            aria-labelledby={`navigation-${section}-title`}
          >
            <h2 id={`navigation-${section}-title`}>
              {section === "header" ? copy.headerTitle : copy.footerTitle}
            </h2>
            <ol className="decoration-sections">
              {rows.map((item, index) => (
                <li
                  key={item.id}
                  data-navigation-header={
                    section === "header" ? item.id : undefined
                  }
                  data-navigation-footer={
                    section === "footer" ? item.id : undefined
                  }
                  data-visible={item.visible}
                >
                  <span
                    className="decoration-section-number"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="decoration-section-name">
                    <strong>{item.label}</strong>
                    {section === "footer" && item.id !== "HOME" && (
                      <label>
                        <input
                          type="checkbox"
                          data-navigation-visible={item.id}
                          aria-label={`${copy.shown}: ${item.label}`}
                          checked={item.visible}
                          disabled={disabled || item.id === "POLICIES"}
                          onChange={(event) => {
                            if (item.id !== "HOME")
                              onChange(
                                setNavigationFooterVisible(
                                  navigation,
                                  item.id,
                                  event.currentTarget.checked,
                                ),
                              );
                          }}
                        />
                        {item.id === "POLICIES" ? copy.required : copy.shown}
                      </label>
                    )}
                  </div>
                  <div className="decoration-section-move">
                    {([-1, 1] as const).map((direction) => (
                      <Button
                        key={direction}
                        type="button"
                        variant="quiet"
                        data-navigation-up={
                          direction === -1 ? `${section}:${item.id}` : undefined
                        }
                        data-navigation-down={
                          direction === 1 ? `${section}:${item.id}` : undefined
                        }
                        disabled={
                          disabled ||
                          (direction === -1
                            ? index === 0
                            : index === rows.length - 1)
                        }
                        aria-label={`${direction === -1 ? copy.moveUp : copy.moveDown}: ${item.label}`}
                        onClick={() =>
                          onChange(
                            moveNavigationItem(
                              navigation,
                              section,
                              item.id,
                              direction,
                            ),
                          )
                        }
                      >
                        <Icon
                          name="chevron-down"
                          className={
                            direction === -1 ? "decoration-up-icon" : ""
                          }
                          decorative
                        />
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      <p className="mc-hint">{copy.regionHint}</p>
    </div>
  );
}
