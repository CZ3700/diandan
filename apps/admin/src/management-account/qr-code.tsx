import { useMemo } from "react";
import qrcode from "qrcode-generator";

// ADR-021 addendum: the library only computes modules; React draws them. No generated HTML is inserted.
const QUIET_ZONE = 4;

export function qrModules(text: string): readonly (readonly boolean[])[] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => qr.isDark(row, column)),
  );
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const modules = useMemo(() => qrModules(value), [value]);
  const size = modules.length + QUIET_ZONE * 2;
  const path = modules
    .flatMap((row, y) =>
      row.map((dark, x) =>
        dark ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : "",
      ),
    )
    .join("");
  return (
    <svg
      className="account-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-qr-modules={modules.length}
    >
      <rect className="account-qr-light" width={size} height={size} />
      <path className="account-qr-dark" d={path} />
    </svg>
  );
}
