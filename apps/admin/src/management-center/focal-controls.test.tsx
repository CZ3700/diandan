import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { FocalControls } from "./focal-controls";
import { managementCopy } from "./copy";

test.each(SUPPORTED_LOCALES)(
  "%s labels all focus inputs and previews exact pixel geometry",
  (locale) => {
    const copy = managementCopy(locale);
    const html = renderToStaticMarkup(
      <FocalControls
        copy={copy}
        kind="SAVE_ARTIST"
        source={{ url: "blob:local-photo", width: 3000, height: 2000 }}
        point={{ x: 0.2, y: 0.5 }}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(html).toContain(copy.adjustFocus);
    expect(html).toContain(copy.focusHorizontal);
    expect(html).toContain(copy.focusVertical);
    expect(html).toContain('data-image-crop="0,0,1600,2000"');
    expect(html).toContain('data-image-crop-role="HERO_DESKTOP"');
    expect(html).toContain('data-image-crop-role="HERO_MOBILE"');
    expect(html.match(/type="range"/gu)).toHaveLength(2);
    expect(html).not.toContain('type="submit"');
  },
);
