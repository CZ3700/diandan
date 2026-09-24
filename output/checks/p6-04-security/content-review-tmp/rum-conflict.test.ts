import { expect, test, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { aggregateRum } from '../../../../packages/observability/src/rum';
import { rumObservationSchema, type RumObservation } from '../../../../packages/contracts/src/rum';
vi.mock('server-only', () => ({}));

test('two admitted anonymous records poison the entire RUM report window', async () => {
  const { createRumIntake } = await import('../../../../apps/storefront/src/server/rum-intake');
  const origin = 'https://shop.example.invalid';
  const records: RumObservation[] = [];
  const handle = createRumIntake({
    environment: { NODE_ENV: 'test', FAN_SUPPORT_DEPLOYMENT_ENV: 'test', FAN_SUPPORT_SITE_ORIGIN: origin, FAN_SUPPORT_RUM_MODE: 'local' },
    sink: { async record(record) { records.push(rumObservationSchema.parse(record)); } },
    now: () => new Date('2026-09-24T12:00:00Z'),
  });
  const statuses: number[] = [];
  for (const [index, value] of [1000, 120, 121].entries()) {
    const body = { schemaVersion: 1, metric: { name: 'INP', value, measurementKey: index === 0 ? '9bad5b7a-a0df-4613-b593-324883405c02' : '2cb0e9c3-1d55-4a91-a9db-343a36fcaa15', revision: 1, navigationType: 'navigate' }, context: { locale: 'en', page: 'home', viewport: 'mobile', automation: 'browser' } };
    statuses.push((await handle(new Request(origin + '/api/storefront/rum', { method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) }))).status);
  }
  expect(statuses).toEqual([204, 204, 204]);
  expect(records).toHaveLength(3);
  expect(aggregateRum(records.slice(0, 1), { windowStart: '2026-09-24T11:59:00Z', windowEnd: '2026-09-24T12:01:00Z' }).uniqueMeasurements).toBe(1);
  expect(() => aggregateRum(records, { windowStart: '2026-09-24T11:59:00Z', windowEnd: '2026-09-24T12:01:00Z' })).toThrow('Conflicting RUM measurement');
  const directory = new URL('./', import.meta.url);
  await writeFile(new URL('synthetic-rum.log', directory), records.map((value) => JSON.stringify(value)).join('\n') + '\n');
  await writeFile(new URL('reproduction-result.json', directory), JSON.stringify({ scenario: 'RUM_CONFLICT_POISONING', requestStatuses: statuses, admittedRecords: records.length, legitimateRecordsIndependentlyUsable: 1, aggregateError: 'Conflicting RUM measurement', networkAccess: false, inputData: 'synthetic' }, null, 2) + '\n');
});
