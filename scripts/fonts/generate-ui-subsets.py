# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.64.0", "brotli==1.2.0"]
# ///
"""Generate deterministic, source-owned UI subsets; the complete original fonts remain fallback."""

import argparse
from io import BytesIO
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import urlopen

from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "packages/design-tokens/styles/fonts/generated"
WEIGHTS = (100, 400, 900)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_source(directory, source, name_key, hash_key):
    filename = directory / source[name_key]
    data = filename.read_bytes()
    if digest(data) != source[hash_key]:
        raise ValueError(f"Pinned source hash mismatch: {filename.name}")
    return data


def download_missing(directory, profiles):
    directory.mkdir(parents=True, exist_ok=True)
    for profile in profiles:
        source = profile["source"]
        for name_key, url_key, hash_key in [
            ("filename", "url", "sha256"),
            ("licenseFilename", "licenseUrl", "licenseSha256"),
        ]:
            destination = directory / source[name_key]
            if destination.exists():
                checked_source(directory, source, name_key, hash_key)
                continue
            url = urlsplit(source[url_key])
            if url.scheme != "https" or url.hostname != "raw.githubusercontent.com":
                raise ValueError("Font sources must use the pinned official repository")
            encoded = urlunsplit(
                (
                    url.scheme,
                    url.netloc,
                    quote(url.path, safe="/"),
                    url.query,
                    url.fragment,
                )
            )
            with urlopen(encoded, timeout=60) as response:
                data = response.read()
            if digest(data) != source[hash_key]:
                raise ValueError("Downloaded source does not match pinned bytes")
            destination.write_bytes(data)


def shape(font, point, weight, cache):
    key = (id(font), weight)
    if key not in cache:
        cache[key] = font.getGlyphSet(location={"wght": weight})
    glyphs = cache[key]
    glyph = glyphs[font.getBestCmap()[point]]
    pen = DecomposingRecordingPen(glyphs)
    glyph.draw(pen)
    return glyph.width, pen.value


def vertical_metrics(font):
    hhea, os2 = font["hhea"], font["OS/2"]
    return {
        "unitsPerEm": font["head"].unitsPerEm,
        "hhea": [hhea.ascent, hhea.descent, hhea.lineGap],
        "typo": [os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap],
        "win": [os2.usWinAscent, os2.usWinDescent],
        "xHeight": os2.sxHeight,
        "capHeight": os2.sCapHeight,
        "useTypoMetrics": bool(os2.fsSelection & (1 << 7)),
    }


def layout_features(font):
    result = {}
    for tag in ("GSUB", "GPOS"):
        table = font[tag].table if tag in font else None
        records = table.FeatureList.FeatureRecord if table and table.FeatureList else []
        result[tag] = sorted({record.FeatureTag for record in records})
    return result


def original_layout_features(originals):
    result = {"GSUB": set(), "GPOS": set()}
    for filename in sorted({item["resource"] for item in originals}):
        with TTFont(filename) as font:
            for tag, features in layout_features(font).items():
                result[tag].update(features)
    return {tag: sorted(features) for tag, features in result.items()}


def verify_shapes(candidate, originals, version):
    """Compare actual outlines/advance against the currently locked Fontsource shards."""
    fonts, cache = {}, {}
    try:
        for item in originals:
            filename = item["resource"]
            if filename not in fonts:
                fonts[filename] = TTFont(filename)
            original = fonts[filename]
            if original["name"].getDebugName(5) != version:
                raise ValueError("Original and candidate font versions differ")
            if vertical_metrics(candidate) != vertical_metrics(original):
                raise ValueError("Changed font vertical metrics")
            for weight in WEIGHTS:
                if shape(candidate, item["point"], weight, cache) != shape(
                    original, item["point"], weight, cache
                ):
                    raise ValueError(
                        f"Changed outline or advance: U+{item['point']:04X}, weight {weight}"
                    )
        return [
            {
                "path": "files/" + Path(filename).name,
                "sha256": digest(Path(filename).read_bytes()),
            }
            for filename in sorted(fonts)
        ]
    finally:
        for font in fonts.values():
            font.close()


def unicode_range(points):
    ranges, start, end = [], None, None
    for point in points:
        if start is None:
            start = end = point
        elif point == end + 1:
            end = point
        else:
            ranges.append(f"U+{start:X}" + (f"-{end:X}" if end != start else ""))
            start = end = point
    ranges.append(f"U+{start:X}" + (f"-{end:X}" if end != start else ""))
    return ",".join(ranges)


def generate(profile, corpus, directory, output):
    source = profile["source"]
    data = checked_source(directory, source, "filename", "sha256")
    license_data = checked_source(directory, source, "licenseFilename", "licenseSha256")
    font = TTFont(BytesIO(data), recalcTimestamp=False)
    if font["name"].getDebugName(5) != source["version"]:
        raise ValueError("Unexpected source font version")
    axes = [
        (axis.axisTag, axis.minValue, axis.defaultValue, axis.maxValue)
        for axis in font["fvar"].axes
    ]
    if axes != [("wght", 100.0, 100.0, 900.0)]:
        raise ValueError("Unexpected source variable axis")
    points = corpus["codepoints"]
    if not set(points).issubset(font.getBestCmap()):
        raise ValueError("Source is missing current UI characters")
    original_features = original_layout_features(corpus["originals"])
    feature_selection = sorted(set().union(*original_features.values()))
    options = subset.Options()
    options.layout_features = feature_selection
    options.recalc_timestamp = False
    options.harfbuzz_repacker = False
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    font.flavor = "woff2"
    buffer = BytesIO()
    font.save(buffer)
    font.close()
    result = buffer.getvalue()
    candidate = TTFont(BytesIO(result))
    if set(candidate.getBestCmap()) != set(points):
        raise ValueError("Subset declared characters differ from actual cmap")
    if [
        (axis.axisTag, axis.minValue, axis.defaultValue, axis.maxValue)
        for axis in candidate["fvar"].axes
    ] != axes:
        raise ValueError("Subset changed the variable axis")
    original_shards = verify_shapes(candidate, corpus["originals"], source["version"])
    metrics = vertical_metrics(candidate)
    candidate_features = layout_features(candidate)
    for tag, features in candidate_features.items():
        if not set(features).issubset(original_features[tag]):
            raise ValueError("Subset added features absent from the original webfonts")
    candidate.close()
    stem = profile["id"] + "-ui"
    css = f'''/* Generated from the complete current storefront UI corpus. See scripts/fonts/README.md. */
@font-face {{
  font-family: "{profile["family"]}";
  font-style: normal;
  font-display: optional;
  font-weight: 100 900;
  src: url("./{stem}.woff2") format("woff2-variations");
  unicode-range: {unicode_range(points)};
}}
'''
    output.mkdir(exist_ok=True, parents=True)
    (output / (stem + ".woff2")).write_bytes(result)
    (output / (stem + ".css")).write_text(css)
    (output / (profile["id"] + "-OFL.txt")).write_bytes(license_data)
    return {
        "profile": profile["id"],
        "catalog": profile["catalog"],
        "corpusSha256": corpus["corpusSha256"],
        "source": source,
        "fontsourcePackage": profile["fontsourcePackage"],
        "fontsourceVersion": profile["fontsourceVersion"],
        "codepoints": points,
        "woff2Sha256": digest(result),
        "woff2Bytes": len(result),
        "originalShards": original_shards,
        "verticalMetrics": metrics,
        "verifiedOutlineWeights": list(WEIGHTS),
        "actualCmapVerified": True,
        "outlineAndAdvanceDifferences": 0,
        "layoutFeatureSelection": feature_selection,
        "originalLayoutFeatures": original_features,
        "subsetLayoutFeatures": candidate_features,
        "variableAxis": axes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument(
        "--download",
        action="store_true",
        help="Fetch missing pinned font sources and verify hashes before writing",
    )
    args = parser.parse_args()
    config = json.loads((ROOT / "scripts/fonts/sources.json").read_text())
    if config["schemaVersion"] != 1:
        raise ValueError("Unsupported font source manifest")
    if args.download:
        download_missing(args.source_dir, config["profiles"])
    corpus = json.loads(
        subprocess.run(
            [args.node, str(ROOT / "scripts/fonts/ui-corpus.mjs")],
            check=True,
            text=True,
            capture_output=True,
        ).stdout
    )
    by_id = {entry["id"]: entry for entry in corpus["profiles"]}
    results = [
        generate(profile, by_id[profile["id"]], args.source_dir, args.output_dir)
        for profile in config["profiles"]
    ]
    (args.output_dir / "manifest.json").write_text(
        json.dumps(
            {"schemaVersion": 1, "profiles": results}, ensure_ascii=False, indent=2
        )
        + "\n"
    )
    formatted = [
        str(args.output_dir / "manifest.json"),
        *[
            str(args.output_dir / (profile["id"] + "-ui.css"))
            for profile in config["profiles"]
        ],
    ]
    subprocess.run(
        [
            args.node,
            str(ROOT / "node_modules/prettier/bin/prettier.cjs"),
            "--write",
            *formatted,
        ],
        check=True,
    )
    subprocess.run(
        [
            args.node,
            str(ROOT / "scripts/fonts/generate-fallback-css.mjs"),
            "--output-dir",
            str(args.output_dir),
            "--ui-dir",
            str(args.output_dir),
        ],
        check=True,
    )
    print(
        json.dumps(
            [
                {
                    "profile": result["profile"],
                    "bytes": result["woff2Bytes"],
                    "codepoints": len(result["codepoints"]),
                }
                for result in results
            ]
        )
    )


if __name__ == "__main__":
    main()
