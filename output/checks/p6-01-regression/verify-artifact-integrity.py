import hashlib
import json
from pathlib import Path

root = Path.cwd()
base = root / 'output/checks/p6-01-regression'
records = []
for name in ['final-8', 'final-operations-9', 'final-journey-9']:
    run = base / name
    report = json.loads((run / 'report.json').read_text())
    assert report['sourceHash'] == '642a55a818680d763f41ce5d87b5386092591ea5341c92ce4e88c8248bcb8b72'
    assert report['status'] == ('FAIL' if name == 'final-8' else 'PASS')
    archive = run / 'artifacts'
    source = Path(report['workspace']) / 'output'
    files = []
    for entry in sorted(archive.rglob('*')):
        assert not entry.is_symlink()
        if not entry.is_file():
            continue
        relative = entry.relative_to(archive)
        assert not any(part.startswith('.') for part in relative.parts)
        assert entry.suffix in ['.json', '.png', '.md', '.txt']
        original = source / relative
        assert original.is_file() and not original.is_symlink()
        data = entry.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        assert digest == hashlib.sha256(original.read_bytes()).hexdigest()
        files.append({'path': str(relative), 'bytes': len(data), 'sha256': digest})
    assert len(files) == report['archive']['files']
    records.append({'run': name, 'originalStatus': report['status'], 'files': files, 'count': len(files), 'matchesSourceOutput': True})
result = {'schemaVersion': 1, 'status': 'PASS', 'scope': 'FULL_ARCHIVE_BYTES_AND_SOURCE_OUTPUT_CORRESPONDENCE_NOT_CONTENT_PRIVACY', 'runs': records}
with (base / 'final-artifact-integrity.json').open('x') as output:
    json.dump(result, output, indent=2, ensure_ascii=False)
    output.write('\n')
print(json.dumps({'status': 'PASS', 'runs': [{key: run[key] for key in ['run', 'count', 'matchesSourceOutput']} for run in records]}))
