import { crc32 } from "node:zlib";
import { describe, expect, test } from "vitest";
import { buildXlsx, XLSX_MEDIA_TYPE } from "./xlsx";

interface ZipEntry {
  readonly name: string;
  readonly text: string;
  readonly crc: number;
  readonly method: number;
}

function readStoredZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    const data = bytes.subarray(dataStart, dataStart + size);
    expect(crc32(data) >>> 0).toBe(crc);
    entries.push({ name, text: new TextDecoder().decode(data), crc, method });
    offset = dataStart + size;
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  const end = bytes.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(entries.length);
  expect(view.getUint32(end + 16, true)).toBe(offset);
  return entries;
}

function part(entries: readonly ZipEntry[], name: string): string {
  const found = entries.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing ${name}`);
  return found.text;
}

describe("buildXlsx", () => {
  test("writes a stored OOXML package with one worksheet per sheet", () => {
    const bytes = buildXlsx([
      {
        name: "Summary",
        rows: [
          { cells: ["Artist", "Orders"], bold: true },
          { cells: ["Aria", 3] },
        ],
      },
      { name: "Details", rows: [{ cells: ["FS-ABC123"] }] },
    ]);
    const entries = readStoredZip(bytes);
    expect(entries.map((entry) => entry.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(entries.every((entry) => entry.method === 0)).toBe(true);
    expect(part(entries, "[Content_Types].xml")).toContain(
      'PartName="/xl/worksheets/sheet2.xml"',
    );
    const workbook = part(entries, "xl/workbook.xml");
    expect(workbook).toContain(
      '<sheet name="Summary" sheetId="1" r:id="rId1"/>',
    );
    expect(workbook).toContain(
      '<sheet name="Details" sheetId="2" r:id="rId2"/>',
    );
    const sheet = part(entries, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Artist</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2"><v>3</v></c>');
    expect(XLSX_MEDIA_TYPE).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  test("keeps text inert: escapes markup, strips control characters and never writes formulas", () => {
    const entries = readStoredZip(
      buildXlsx([
        {
          name: "S",
          rows: [
            {
              cells: [
                '=HYPERLINK("x")',
                "<b>&'\"",
                "a\u0000b\u0008c\td",
                "+1",
                "@x",
              ],
            },
          ],
        },
      ]),
    );
    const sheet = part(entries, "xl/worksheets/sheet1.xml");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain(
      '<t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>',
    );
    expect(sheet).toContain(
      '<t xml:space="preserve">&lt;b&gt;&amp;&apos;&quot;</t>',
    );
    expect(sheet).toContain('<t xml:space="preserve">abc\td</t>');
    expect(sheet).toContain('<t xml:space="preserve">+1</t>');
  });

  test("writes decimal amounts exactly with a fixed number format and leaves null cells empty", () => {
    const entries = readStoredZip(
      buildXlsx([
        {
          name: "S",
          columns: [12, 20],
          rows: [
            {
              cells: [
                { decimal: "1234.50", places: 2 },
                null,
                { decimal: "-0.05", places: 2 },
              ],
            },
            {
              cells: [
                { decimal: "3000", places: 0 },
                { decimal: "1.234", places: 3 },
              ],
            },
          ],
        },
      ]),
    );
    const sheet = part(entries, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain(
      '<cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/></cols>',
    );
    expect(sheet).toMatch(
      /<c r="A1" s="\d+"><v>1234.50<\/v><\/c><c r="C1" s="\d+"><v>-0.05<\/v><\/c>/,
    );
    expect(sheet).toMatch(
      /<c r="A2" s="\d+"><v>3000<\/v><\/c><c r="B2" s="\d+"><v>1.234<\/v><\/c>/,
    );
    const styles = part(entries, "xl/styles.xml");
    expect(styles).toContain('formatCode="0.000"');
  });

  test("addresses columns past Z", () => {
    const cells = Array.from({ length: 28 }, (_, index) => index);
    const sheet = part(
      readStoredZip(buildXlsx([{ name: "S", rows: [{ cells }] }])),
      "xl/worksheets/sheet1.xml",
    );
    expect(sheet).toContain(
      '<c r="Z1"><v>25</v></c><c r="AA1"><v>26</v></c><c r="AB1"><v>27</v></c>',
    );
  });

  test("rejects sheet names Excel would refuse and values that are not exact", () => {
    expect(() => buildXlsx([])).toThrow();
    expect(() => buildXlsx([{ name: "a/b", rows: [] }])).toThrow();
    expect(() => buildXlsx([{ name: "x".repeat(32), rows: [] }])).toThrow();
    expect(() =>
      buildXlsx([
        { name: "Same", rows: [] },
        { name: "same", rows: [] },
      ]),
    ).toThrow();
    expect(() =>
      buildXlsx([{ name: "S", rows: [{ cells: [1.5] }] }]),
    ).toThrow();
    expect(() =>
      buildXlsx([
        { name: "S", rows: [{ cells: [{ decimal: "1e3", places: 0 }] }] },
      ]),
    ).toThrow();
    expect(() =>
      buildXlsx([
        { name: "S", rows: [{ cells: [{ decimal: "1.5", places: 2 }] }] },
      ]),
    ).toThrow();
  });

  test("is deterministic and non-ASCII text survives", () => {
    const sheets = [
      { name: "汇总", rows: [{ cells: ["艺人", "ศิลปิน", "Nghệ sĩ"] }] },
    ];
    const first = buildXlsx(sheets);
    expect(buildXlsx(sheets)).toEqual(first);
    const entries = readStoredZip(first);
    expect(part(entries, "xl/workbook.xml")).toContain('name="汇总"');
    expect(part(entries, "xl/worksheets/sheet1.xml")).toContain("ศิลปิน");
  });
});
