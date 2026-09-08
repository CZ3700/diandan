// No public read, diagnostic, or deliberate delay may precede the first add.
export async function observeImmediateDailyCartTrial({
  initialize,
  publish,
  add,
  diagnose,
}) {
  const session = await initialize();
  const gift = await publish();
  const publishedAt = globalThis.performance.now();
  let result = null;
  let error = null;
  const publishToAddMs = globalThis.performance.now() - publishedAt;
  try {
    result = await add(gift, session);
  } catch (caught) {
    error = caught;
  }
  const diagnostics = await diagnose(gift);
  return { gift, session, result, error, diagnostics, publishToAddMs };
}
