"""Inspect the six fixed original captures; never resample or select best runs."""
import hashlib
import json
import pathlib
import statistics
import sys

fixture = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent
selectors = ['.fs-composite-state', '.fs-idol-portrait',
             '.fs-gift-tile', '.fs-cart-line', '.fs-order-timeline']
groups = []
all_settings = []
raw_count = 0
for number, stage in [(1, 'baseline'), (2, 'candidate')]:
    folder = fixture / f'browser-attempt-{number}' / 'gift-render-trace'
    capture = json.loads((folder / 'results.json').read_text())
    assert len(capture['attempts']) == 3
    assert capture['conditions']['traceProfile'] == 'standard'
    attempts = []
    for entry in capture['attempts']:
        assert entry['failure'] is None
        for record in entry['files'].values():
            data = (folder / record['file']).read_bytes()
            assert len(data) == record['bytes']
            assert hashlib.sha256(data).hexdigest() == record['sha256']
            raw_count += 1
        lhr = json.loads((folder / (entry['name'] + '.json')).read_text())
        artifacts = json.loads((folder / (entry['name'] + '-artifacts.json')).read_text())
        assert lhr['audits']['storefront-content']['score'] == 1
        assert not lhr.get('runtimeError')
        assert entry['reads']['counts'] == {'GIFT_CONTENT': 0, 'STOREFRONT_GIFT': 1}
        assert all(r['status'] == 200 for r in entry['reads']['requests'])
        assert lhr['configSettings'] == artifacts['settings']
        all_settings.append(lhr['configSettings'])
        rows = lhr['audits']['network-requests']['details']['items']
        resources = {}
        for kind in ['Stylesheet', 'Script', 'Font', 'Image', 'Document']:
            selected = [r for r in rows if r.get('resourceType') == kind]
            resources[kind] = {'count': len(selected),
                               'resourceBytes': sum(r['resourceSize'] for r in selected),
                               'transferBytes': sum(r['transferSize'] for r in selected)}
        sheets = '\n'.join(s['content'] for s in artifacts['Stylesheets'])
        present = {selector: selector in sheets for selector in selectors}
        assert all(present.values()) if stage == 'baseline' else not any(present.values())
        assert '.fs-motion-hero' in sheets
        assert '.fs-media' in sheets and '.fs-overlay' in sheets
        fonts = sorted((r['url'].split('/')[-1], r['resourceSize']) for r in rows
                       if r.get('resourceType') == 'Font')
        metrics = lhr['audits']['metrics']['details']['items'][0]
        attempts.append({'name': entry['name'], 'resources': resources,
                         'compositeSelectorsPresent': present, 'fontResources': fonts,
                         'lcpMs': lhr['audits']['largest-contentful-paint']['numericValue'],
                         'observedLcpMs': metrics['observedLargestContentfulPaint'],
                         'score': lhr['categories']['performance']['score'],
                         'cls': lhr['audits']['cumulative-layout-shift']['numericValue']})
    groups.append({'stage': stage, 'capture': str(folder / 'results.json'),
                   'status': capture['status'], 'attempts': attempts,
                   'medianLcpMs': statistics.median(a['lcpMs'] for a in attempts)})
assert all(s == all_settings[0] for s in all_settings)
baseline, candidate = groups
base_css = baseline['attempts'][0]['resources']['Stylesheet']
new_css = candidate['attempts'][0]['resources']['Stylesheet']
assert all(a['resources']['Stylesheet'] == base_css for a in baseline['attempts'])
assert all(a['resources']['Stylesheet'] == new_css for a in candidate['attempts'])
assert new_css['resourceBytes'] < base_css['resourceBytes']
assert new_css['transferBytes'] < base_css['transferBytes']
font_resources = baseline['attempts'][0]['fontResources']
assert all(a['fontResources'] == font_resources for g in groups for a in g['attempts'])
publication_files = [fixture / f'browser-attempt-{i}' / 'gift-render-trace' /
                     'fixture-publication-response.txt' for i in [1, 2]]
assert publication_files[0].read_bytes() == publication_files[1].read_bytes()
report = {'schemaVersion': 1, 'status': 'RESOURCE_ISOLATION_VERIFIED',
          'rawFilesVerified': raw_count, 'groups': groups,
          'cssSaved': {key: base_css[key] - new_css[key]
                       for key in ['resourceBytes', 'transferBytes']},
          'sameSettings': True, 'sameFontResources': True,
          'sameGroupStartPublicationResponse': True,
          'formalPerformanceAcceptance': False,
          'caveat': 'Fixed sequential diagnostic groups; server/image cache and timing may differ. '
                    'LCP difference alone is not a causal improvement or full budget pass.'}
(out / 'comparison-summary.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'rawFiles': raw_count,
                  'cssSaved': report['cssSaved'],
                  'lcpMedians': [g['medianLcpMs'] for g in groups]}))
