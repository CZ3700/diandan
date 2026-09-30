/**
 * Minimal .xlsx writer for browser-side exports. Text is always an inline string, so a cell that starts with
 * "=" is shown as text and never evaluated; numbers are exact integers or decimal literals with a fixed format.
 * The package is a stored (uncompressed) ZIP, so no compression library is needed.
 */

export const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type XlsxDecimalPlaces = 0 | 1 | 2 | 3;

export type XlsxCell =
  | string
  | number
  | { readonly decimal: string; readonly places: XlsxDecimalPlaces }
  | null;

export interface XlsxRow {
  readonly cells: readonly XlsxCell[];
  readonly bold?: boolean;
}

export interface XlsxSheet {
  readonly name: string;
  readonly columns?: readonly number[];
  readonly rows: readonly XlsxRow[];
}

const MAX_CELL_TEXT = 32767;
const FORBIDDEN_SHEET_NAME = /[[\]:*?/\\]/u;
// XML 1.0 allows tab, line feed and carriage return but no other C0 control characters.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/gu;

// Style indexes into cellXfs below: 0 default, 1 bold, 2–5 fixed decimals with 0–3 places.
const BOLD_STYLE = 1;
const DECIMAL_STYLE_BASE = 2;

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.000"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

export function buildXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  validateSheets(sheets);
  const files: [string, string][] = [
    ["[Content_Types].xml", contentTypesXml(sheets.length)],
    ["_rels/.rels", ROOT_RELS_XML],
    ["xl/workbook.xml", workbookXml(sheets)],
    ["xl/_rels/workbook.xml.rels", workbookRelsXml(sheets.length)],
    ["xl/styles.xml", STYLES_XML],
    ...sheets.map((sheet, index): [string, string] => [
      `xl/worksheets/sheet${index + 1}.xml`,
      worksheetXml(sheet),
    ]),
  ];
  const encoder = new TextEncoder();
  return storedZip(
    files.map(([name, text]) => ({
      name: encoder.encode(name),
      data: encoder.encode(text),
    })),
  );
}

function validateSheets(sheets: readonly XlsxSheet[]): void {
  if (sheets.length === 0)
    throw new RangeError("A workbook needs at least one sheet");
  const seen = new Set<string>();
  for (const sheet of sheets) {
    const name = sheet.name;
    if (
      name.length === 0 ||
      name.length > 31 ||
      FORBIDDEN_SHEET_NAME.test(name) ||
      name.startsWith("'") ||
      name.endsWith("'")
    ) {
      throw new RangeError(
        "Sheet names must be 1–31 characters without [ ] : * ? / \\ or edge apostrophes",
      );
    }
    const key = name.toLocaleLowerCase("en");
    if (seen.has(key)) throw new RangeError("Sheet names must be unique");
    seen.add(key);
  }
}

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

function contentTypesXml(sheetCount: number): string {
  const sheetOverrides = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheetOverrides +
    "</Types>"
  );
}

function workbookXml(sheets: readonly XlsxSheet[]): string {
  const entries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${entries}</sheets></workbook>`
  );
}

function workbookRelsXml(sheetCount: number): string {
  const sheetRels = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetRels +
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>"
  );
}

function worksheetXml(sheet: XlsxSheet): string {
  const columns =
    sheet.columns !== undefined && sheet.columns.length > 0
      ? `<cols>${sheet.columns
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row.cells
        .map((cell, columnIndex) =>
          cellXml(
            cell,
            `${columnName(columnIndex)}${rowIndex + 1}`,
            row.bold === true,
          ),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${columns}<sheetData>${rows}</sheetData></worksheet>`
  );
}

function cellXml(cell: XlsxCell, reference: string, bold: boolean): string {
  if (cell === null) return "";
  if (typeof cell === "string") {
    const style = bold ? ` s="${BOLD_STYLE}"` : "";
    const text = escapeXml(
      cell.replace(XML_INVALID, "").slice(0, MAX_CELL_TEXT),
    );
    return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
  }
  if (typeof cell === "number") {
    if (!Number.isSafeInteger(cell))
      throw new RangeError("Plain numeric cells must be safe integers");
    const style = bold ? ` s="${BOLD_STYLE}"` : "";
    return `<c r="${reference}"${style}><v>${cell}</v></c>`;
  }
  const pattern =
    cell.places === 0
      ? /^-?\d+$/u
      : new RegExp(`^-?\\d+\\.\\d{${cell.places}}$`, "u");
  if (!pattern.test(cell.decimal))
    throw new RangeError("Decimal cells need exactly the declared places");
  return `<c r="${reference}" s="${DECIMAL_STYLE_BASE + cell.places}"><v>${cell.decimal}</v></c>`;
}

function columnName(index: number): string {
  let name = "";
  let remaining = index + 1;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface ZipFile {
  readonly name: Uint8Array;
  readonly data: Uint8Array;
}

// DOS date/time 1980-01-01 00:00 keeps the output byte-for-byte deterministic.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_FLAG = 0x0800;

function storedZip(files: readonly ZipFile[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + file.name.length + file.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, DOS_TIME, true);
    localView.setUint16(12, DOS_DATE, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, file.name.length, true);
    localView.setUint16(28, 0, true);
    local.set(file.name, 30);
    local.set(file.data, 30 + file.name.length);
    locals.push(local);

    const central = new Uint8Array(46 + file.name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, UTF8_FLAG, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, DOS_TIME, true);
    centralView.setUint16(14, DOS_DATE, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, file.name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(file.name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let position = 0;
  for (const chunk of [...locals, ...centrals, end]) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

let crcTable: Uint32Array | undefined;

function crc32(data: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
