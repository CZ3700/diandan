import { useCallback, useEffect, useState } from "react";
import { createPrivateView } from "./private-state";

/** Raw content stays in the mounted private panel, with no SSR or durable cache. */
export function usePrivateView<T>(load: () => Promise<T>, onClose: () => void) {
  const [view] = useState(() => createPrivateView<T>());
  const [, render] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const clear = useCallback(() => {
    view.clear();
    render((value) => value + 1);
  }, [view]);
  useEffect(() => {
    const request = view.begin();
    let mounted = true;
    setLoading(true);
    setError(null);
    void load()
      .then((value) => {
        if (mounted && view.accept(request, value))
          render((current) => current + 1);
      })
      .catch((failure) => {
        if (mounted) setError(failure);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      view.clear();
    };
  }, [view, load, attempt]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== "visible") {
        view.clear();
        onClose();
      }
    };
    const leave = () => {
      view.clear();
      onClose();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      view.clear();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, [view, onClose]);
  return {
    value: view.read(),
    error,
    loading,
    clear,
    retry: () => setAttempt((value) => value + 1),
  };
}
