/** Runs synchronously before hydration on the exchange page. Raw fragment stays in a short-lived closure. */
export const ORDER_ENTRY_SCRIPT = `(()=>{
  let fragment = location.hash;
  try { history.replaceState(history.state, "", location.pathname); }
  catch { fragment = null; }
  const wipe = () => { fragment = null; };
  const timer = setTimeout(wipe, 15000);
  window.addEventListener("pagehide", wipe, { once: true });
  window.__fanOrderEntry = () => {
    const value = fragment;
    wipe();
    clearTimeout(timer);
    return value;
  };
})();`;
