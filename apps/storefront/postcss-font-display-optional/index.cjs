/* global module */

"use strict";

function fontDisplayOptional() {
  return {
    postcssPlugin: "fan-support-font-display-optional",
    Declaration(declaration) {
      const parent = declaration.parent;
      if (
        declaration.prop.toLowerCase() === "font-display" &&
        declaration.value.trim().toLowerCase() === "swap" &&
        parent?.type === "atrule" &&
        parent.name.toLowerCase() === "font-face"
      ) {
        declaration.value = "optional";
      }
    },
  };
}

module.exports = fontDisplayOptional;
