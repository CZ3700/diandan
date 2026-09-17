"""One-off offline extraction for the fixed twelve compositor captures; no reruns."""
import collections
import datetime
import hashlib
import json
import pathlib

BASE = pathlib.Path('output/checks/p3-06-storefront-acceptance/run-2026-09-17T16-33-58-576Z')
OUTPUT = pathlib.Path('output/checks/p3-06-compositor-repro/trace-audit.compact.json')
samples = []
settings = []
for group in range(1, 5):
    directory = BASE / f'compositor-group-{group}' / 'gift-render-trace'
    manifest_bytes = (directory / 'results.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    for number in range(1, 4):
        stem = f'zh-CN-gift-mobile-{number}'
        attempt = next(a for a in manifest['attempts'] if a['attempt'] == number)
        bindings = []
        for suffix in ['.json', '-trace.json', '-devtools.json', '-artifacts.json', '-config.json']:
            descriptor = attempt['files'][suffix]
            source = directory / descriptor['file']
            data = source.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            assert digest == descriptor['sha256'] and len(data) == descriptor['bytes']
            bindings.append(dict(file=str(source), bytes=len(data), sha256=digest, manifestVerified=True))
        events = json.loads((directory / (stem + '-trace.json')).read_text())['traceEvents']
        config = json.loads((directory / (stem + '-config.json')).read_text())
        lhr = json.loads((directory / (stem + '.json')).read_text())
        devtools = json.loads((directory / (stem + '-devtools.json')).read_text())
        settings.append(lhr['configSettings'])
        assert lhr['requestedUrl'] == config['url']
        assert config['lhrSettings'] == lhr['configSettings']
        navs = [e for e in events if e['name'] == 'navigationStart' and e['args']['data'].get('documentLoaderURL') == config['url'] and e['args']['data'].get('isOutermostMainFrame')]
        assert len(navs) == 1
        nav = navs[0]
        origin, pid, main_tid = nav['ts'], nav['pid'], nav['tid']
        frame, navid = nav['args']['frame'], nav['args']['data']['navigationId']
        ms = lambda ts: round((ts - origin) / 1000, 3)
        lcps = [e for e in events if e['pid'] == pid and e['name'] == 'largestContentfulPaint::Candidate' and e['args']['data'].get('navigationId') == navid and e['args'].get('frame') == frame]
        lcp = max(lcps, key=lambda e: e['ts'])
        fcp = next(e for e in events if e['pid'] == pid and e['name'] == 'firstContentfulPaint' and e['args']['data'].get('navigationId') == navid)
        by_local = collections.defaultdict(list)
        for index, event in enumerate(events):
            if event['pid'] == pid and 'local' in event.get('id2', {}):
                by_local[(event['tid'], event['id2']['local'])].append((index, event))
        pipelines = []
        for (tid, local_id), indexed in by_local.items():
            for position, (index, begin) in enumerate(indexed):
                if begin['name'] != 'PipelineReporter' or begin['ph'] != 'b':
                    continue
                ends = [(i, e) for i, e in indexed[position + 1:] if e['name'] == 'PipelineReporter' and e['ph'] == 'e' and e['ts'] >= begin['ts']]
                assert ends, ('Missing reporter end', group, number, local_id)
                end_index, end = ends[0]
                if begin['ts'] > lcp['ts'] or end['ts'] < origin:
                    continue
                stages = []
                for stage_position, (stage_index, stage) in enumerate(indexed):
                    if stage['ph'] != 'b' or stage['name'] == 'PipelineReporter' or not begin['ts'] <= stage['ts'] < end['ts'] or not index <= stage_index < end_index:
                        continue
                    stage_end_index, stage_end = next((i, e) for i, e in indexed[stage_position + 1:] if e['name'] == stage['name'] and e['ph'] == 'e' and e['ts'] >= stage['ts'])
                    assert stage_end['ts'] <= end['ts']
                    stages.append(dict(name=stage['name'], startMs=ms(stage['ts']), endMs=ms(stage_end['ts']), durationMs=round((stage_end['ts'] - stage['ts']) / 1000, 3), beginEventIndex=stage_index, endEventIndex=stage_end_index))
                metadata = begin['args']['frame_reporter']
                pipelines.append(dict(pid=pid, tid=tid, localId=local_id, beginEventIndex=index, endEventIndex=end_index, startMs=ms(begin['ts']), endMs=ms(end['ts']), frameSequence=metadata['frame_sequence'], frameType=metadata.get('frame_type', 'UNSPECIFIED'), state=metadata['state'], layerTreeHostId=metadata.get('layer_tree_host_id'), highLatency=metadata.get('has_high_latency'), stages=stages))
        def links(timestamp):
            return [dict(localId=p['localId'], tid=p['tid'], frameSequence=p['frameSequence'], frameType=p['frameType'], state=p['state']) for p in pipelines if any(s['name'] == 'SubmitCompositorFrameToPresentationCompositorFrame' and s['endMs'] == ms(timestamp) for s in p['stages'])]
        lcp_links, fcp_links = links(lcp['ts']), links(fcp['ts'])
        original_lcp = [p for p in lcp_links if p['frameType'] == 'UNSPECIFIED' and p['state'] == 'STATE_PRESENTED_ALL']
        assert original_lcp and len({p['tid'] for p in original_lcp}) == 1, (group, number, lcp_links)
        compositor_tid = original_lcp[0]['tid']
        scanned_stages = []
        for p in pipelines:
            for stage in p['stages']:
                if stage['name'] == 'EndActivateToSubmitCompositorFrame' and stage['startMs'] <= ms(lcp['ts']) and stage['endMs'] >= 0:
                    scanned_stages.append(dict(localId=p['localId'], tid=p['tid'], frameSequence=p['frameSequence'], frameType=p['frameType'], state=p['state'], hasRecordedActivation=any(s['name'] == 'Activation' for s in p['stages']), beginsBeforeNavigation=stage['startMs'] < 0, endsAfterFinalLcp=stage['endMs'] > ms(lcp['ts']), **stage))
        pending = [e for e in events if e['pid'] == pid and e['tid'] == compositor_tid and e['name'] == 'Scheduler:pending_submit_frames']
        acks = [e for e in events if e['pid'] == pid and e['tid'] == compositor_tid and e['name'] == 'ProxyImpl::DidReceiveCompositorFrameAckOnImplThread']
        pending_intervals = []
        for i, begin in enumerate(pending):
            if begin['ph'] != 'b' or not origin <= begin['ts'] <= lcp['ts']:
                continue
            end = next(e for e in pending[i + 1:] if e['ph'] == 'e' and e['id2'] == begin['id2'] and e['ts'] >= begin['ts'])
            ack = min(acks, key=lambda e: abs(e['ts'] - end['ts']))
            pending_intervals.append(dict(localId=begin['id2']['local'], startMs=ms(begin['ts']), endMs=ms(end['ts']), durationMs=round((end['ts'] - begin['ts']) / 1000, 3), reportedPendingFrames=begin['args'].get('pending_frames'), nearestAckStartMs=ms(ack['ts']), ackDurationMs=ack.get('dur', 0) / 1000, ackContainsEnd=ack['ts'] <= end['ts'] <= ack['ts'] + ack.get('dur', 0), endsAfterFinalLcp=end['ts'] > lcp['ts']))
        begin_impl = sorted([e for e in events if e['pid'] == pid and e['tid'] == compositor_tid and e['name'] == 'Scheduler::BeginImplFrame' and origin <= e['ts'] <= lcp['ts']], key=lambda e:e['ts'])
        begin_records = [dict(startMs=ms(e['ts']), sequence=e['args']['args']['sequence_number'], subtype=e['args']['args'].get('subtype'), framesThrottledSinceLast=e['args']['args'].get('frames_throttled_since_last'), mainThreadMissedLastDeadline=e['args'].get('main_thread_missed_last_deadline')) for e in begin_impl]
        needs_changes = [dict(startMs=ms(e['ts']), needsBeginFrame=e['args']['data']['needsBeginFrame'], layerTreeId=e['args'].get('layerTreeId')) for e in events if e['pid'] == pid and e['tid'] == compositor_tid and e['name'] == 'NeedsBeginFrameChanged' and origin <= e['ts'] <= lcp['ts']]
        dropped = [e for e in events if e['pid'] == pid and e['tid'] == compositor_tid and e['name'] == 'DroppedFrame' and origin <= e['ts'] <= lcp['ts']]
        image_ids = {e['params']['requestId'] for e in devtools if e['method'] == 'Network.requestWillBeSent' and e['params'].get('type') == 'Image'}
        image_ends = [dict(requestId=e['params']['requestId'], finishMs=ms(e['params']['timestamp'] * 1e6)) for e in devtools if e['method'] == 'Network.loadingFinished' and e['params']['requestId'] in image_ids]
        assert len(image_ends) == 1
        target_node = lcp['args']['data']['nodeId']
        paints = [dict(startMs=ms(e['ts']), nodeId=target_node, durationMs=e.get('dur', 0) / 1000) for e in events if e['pid'] == pid and e['name'] == 'PaintImage' and e.get('args', {}).get('data', {}).get('nodeId') == target_node and origin <= e['ts'] <= lcp['ts']]
        anomalies = [s for s in scanned_stages if s['durationMs'] > 500]
        sample = dict(group=group, attempt=number, captureManifest=str(directory / 'results.json'), captureManifestSha256=hashlib.sha256(manifest_bytes).hexdigest(), bindings=bindings, navigation=dict(originUs=origin, pid=pid, mainTid=main_tid, compositorTid=compositor_tid, frame=frame, navigationId=navid), observed=dict(fcpMs=ms(fcp['ts']), lcpMs=ms(lcp['ts']), candidates=[dict(startMs=ms(e['ts']), type=e['args']['data']['type'], nodeId=e['args']['data']['nodeId']) for e in lcps], imageNetwork=image_ends[0], targetNodePaints=paints), simulatedSeparate=dict(fcpMs=lhr['audits']['first-contentful-paint']['numericValue'], lcpMs=lhr['audits']['largest-contentful-paint']['numericValue']), fcpPipelineLinks=fcp_links, lcpPipelineLinks=lcp_links, pipelinesOverlappingNavigationThroughLcp=pipelines, scannedActivationToSubmitStages=scanned_stages, over500msStages=anomalies, pendingIntervalsStartedBeforeLcp=pending_intervals, recordedBeginImplFrames=begin_records, needsBeginFrameChanges=needs_changes, droppedFramesBeforeLcp=dict(count=len(dropped), sequences=[e['args']['frameSeqId'] for e in dropped]))
        if anomalies:
            assert group == 1 and number == 1, 'Retain unexpected anomaly for additional bounded inspection'
            stage = anomalies[0]
            start, end = origin + round(stage['startMs'] * 1000), origin + round(stage['endMs'] * 1000)
            viz_decisions = [e for e in events if e['name'] == 'SendBeginFrameDecision' and start <= e['ts'] <= end]
            flow_records = []
            for e in events:
                if e['name'] != 'Graphics.Pipeline' or e.get('id') not in [458, 479, 1047, 1055]:
                    continue
                enclosing = [x for x in events if x['name'] == 'Graphics.Pipeline' and x['ph'] in ['X', 'I'] and x['pid'] == e['pid'] and x['tid'] == e['tid'] and x['ts'] == e['ts']]
                flow_records.append(dict(flowId=e['id'], phase=e['ph'], pid=e['pid'], tid=e['tid'], startMs=ms(e['ts']), steps=[{k:v for k,v in x['args'].get('chrome_graphics_pipeline', {}).items() if k != 'surface_frame_trace_id'} for x in enclosing]))
            relevant_names = ['ExternalBeginFrameSource::OnBeginFrame', 'Scheduler::BeginFrame', 'Scheduler::BeginImplFrame', 'ProxyImpl::DidReceiveCompositorFrameAckOnImplThread', 'Scheduler::SetDeferBeginMainFrame']
            renderer_events = [dict(name=e['name'], phase=e['ph'], startMs=ms(e['ts']), durationMs=e.get('dur', 0) / 1000, args=e.get('args', {})) for e in events if e['pid'] == pid and e['tid'] == compositor_tid and e['name'] in relevant_names and origin <= e['ts'] <= lcp['ts']]
            needs_spans = [dict(phase=e['ph'], startMs=ms(e['ts']), localId=e.get('id2', {}).get('local')) for e in events if e['pid'] == pid and e['tid'] == compositor_tid and e['name'] == 'NeedsBeginFrames']
            all_long = [dict(name=e['name'], pid=e['pid'], tid=e['tid'], startMs=ms(e['ts']), durationMs=e['dur'] / 1000) for e in events if e.get('dur',0) > 100000 and e['ts'] <= end and e['ts'] + e['dur'] >= start]
            sample['anomalyDetail'] = dict(pendingIntervalsOverlappingWait=[p for p in pending_intervals if p['startMs'] < stage['endMs'] and p['endMs'] > stage['startMs']], rendererCompositorEvents=renderer_events, needsBeginFramesSpans=needs_spans, graphicsFlowEdges=flow_records, vizDecisionCounts=dict(collections.Counter(e['args'].get('reason') for e in viz_decisions)), vizDecisionBindingCaveat='Decision events contain reason but no frame_sink_id. Multi-sink counts are not assigned to the target sink. Large surface_frame_trace_id values are already lossy in captured JSON and are not used as unique linkage.', longRecordedXEventsOver100msOverlappingWait=all_long)
        samples.append(sample)
assert len(samples) == 12 and all(s == settings[0] for s in settings)
result = dict(schemaVersion=1, generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), purpose='All twelve fixed extended-trace captures, including every target-renderer activation-to-submit stage overlapping navigation through final LCP; no new measurements or formal budget closure.', clock='All times in milliseconds from selected main-frame navigationStart. Phases ending after final LCP are retained and flagged.', configSettingsIdenticalAcross12=True, verifiedInputFiles=sum(len(s['bindings']) for s in samples), samples=samples, limitations=['Extra diagnostic tracing is not comparable to the default-profile formal budget dataset.', 'No-event findings are limited to the enabled categories and bound renderer/thread.', 'A matching ACK end rejects sustained pending occupancy for this occurrence; it does not prove every browser cause.', 'Viz SendBeginFrameDecision has no direct frame-sink identity, so target-specific throttling remains unproven.'])
OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(dict(output=str(OUTPUT), bytes=OUTPUT.stat().st_size, samples=len(samples), verifiedInputFiles=result['verifiedInputFiles'], anomalyCount=sum(len(s['over500msStages']) for s in samples)), ensure_ascii=False))
for s in samples:
    print(json.dumps(dict(group=s['group'], attempt=s['attempt'], fcp=s['observed']['fcpMs'], lcp=s['observed']['lcpMs'], scanned=len(s['scannedActivationToSubmitStages']), maxWait=max(x['durationMs'] for x in s['scannedActivationToSubmitStages']), over500=s['over500msStages'], maxPending=max(x['durationMs'] for x in s['pendingIntervalsStartedBeforeLcp']), dropped=s['droppedFramesBeforeLcp']['count']), ensure_ascii=False))
