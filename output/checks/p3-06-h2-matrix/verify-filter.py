"""Bind current public filter evidence to the retained incomplete records."""
import hashlib
import json
import pathlib

root = pathlib.Path(__file__).resolve().parents[3]
base = root / "output/checks/p3-06-h2-matrix"
original = root / "output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-55-54-248Z/browser-attempt-3/browser-results.json"
history = root / "output/checks/p3-06-storefront-acceptance/run-2026-09-07T17-13-43-828Z/axe-incomplete-probe-attempt-1/axe-incomplete-review.json"
directory = root / "output/checks/p3-06-storefront-acceptance/run-2026-09-21T16-49-18-618Z/browser-attempt-1/filter-probe-176253d2-9ff4-4356-a361-a1dfeaf0ec69"
read = lambda file: json.loads(file.read_text())
prior, historical, current = read(original), read(history), read(directory / "results.json")
entries = [(scan["name"], item) for scan in prior["axe"] for item in scan["incomplete"]]
assert len(entries) == 30 and not any(scan["violations"] for scan in prior["axe"])
cards = [(name, item) for name, item in entries if name != "mobile-filter-open"]
assert len(cards) == 28 and sum(len(item["nodes"]) for _, item in cards) == 532
assert all(item["id"] == "color-contrast" and all("figcaption" in node["target"][0] for node in item["nodes"]) for _, item in cards)
old_sources = read(root / "output/checks/p3-04-storefront/implementation-source-final.json")
old_hashes = {entry["path"]: entry["sha256"] for entry in old_sources["files"]}
styles = []
for relative in ["apps/storefront/src/storefront/artist-directory.module.css", "packages/design-tokens/styles/foundations.css", "packages/ui/styles/interactions.css"]:
    digest = hashlib.sha256((root / relative).read_bytes()).hexdigest()
    assert old_hashes[relative] == digest
    styles.append({"path": relative, "sha256": digest})
observations = [item for sample in historical["contrast"] for item in sample["observations"]]
assert len(historical["contrast"]) == 12 and len(observations) == 24
assert all(item["fullyWithinViewportAndTrack"] and item["centerUnobscured"] and item["contrastRatio"] >= 4.5 for item in observations)
assert current["status"] == "PASS_SUPPLEMENTAL_PROBES"
assert len(current["checks"]) == 127 and all(item["pass"] for item in current["checks"])
assert current["axe"]["violations"] == 0 and current["axe"]["incomplete"] == 2
assert current["contextClosed"] and current["browserClosed"] and current["focusReturned"]
keys = current["originalScenarioKeys"] + current["supplementalKeys"]
assert len(keys) == 60 and all(item["settled"]["inside"] for item in keys)
assert not current["pageErrors"]
contrasts = [item for item in current["nodes"] if item["rule"] == "color-contrast"]
assert len(contrasts) == 1
node = contrasts[0]
assert node["observation"]["tag"] == "P" and node["contrast"]["status"] == "PASS_NORMAL_TEXT_AA"
assert all(point["targetReceivesHit"] for point in node["observation"]["hitPoints"])
manifest = []
for file in [original, history, directory / "results.json", directory / "axe.json", *(directory / name for name in current["screenshots"])]:
    data = file.read_bytes()
    manifest.append({"path": str(file.relative_to(root)), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
result = {
    "schemaVersion": 1,
    "status": "PASS_TECHNICAL_REVIEW",
    "originalIncompleteEntriesRetained": 30,
    "directoryEntriesReviewed": 28,
    "directoryNodes": 532,
    "historicalActualCards": 12,
    "historicalActualTextObservations": 24,
    "currentStyleHashesMatchHistoricalBaseline": styles,
    "currentFilterChecks": 127,
    "currentFilterAxeIncompleteRetained": 2,
    "currentFilterContrast": node["contrast"],
    "currentFilterText": node["observation"]["text"],
    "currentFilterKeys": 60,
    "transientGuardsSettledWithinOriginal500Ms": sum(not item["initial"]["inside"] for item in keys),
    "escapeRestoredFocus": True,
    "contextAndBrowserClosed": True,
    "rawFiles": manifest,
    "scope": "Historical real-browser directory samples plus unchanged CSS and current exact filter DOM, contrast, hit points and keyboard proof. Technical review only; original axe incomplete retained. Not screen-reader, human operator, physical-device, translation or production-photo approval.",
}
(base / "filter-summary.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"status": result["status"], "checks": 127, "keys": 60, "contrastRatio": node["contrast"]["ratio"]}))
