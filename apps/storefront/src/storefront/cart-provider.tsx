"use client";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { createCartSession, type CartSession } from "./cart-session";
const Context = createContext<{
  session: CartSession;
  restoreOnLoad: boolean;
} | null>(null);
export function CartProvider({
  locale,
  children,
  restoreOnLoad = true,
}: Readonly<{
  locale: SupportedLocale;
  children: ReactNode;
  restoreOnLoad?: boolean;
}>) {
  const [session] = useState(() => createCartSession(locale));
  return (
    <Context.Provider value={{ session, restoreOnLoad }}>
      {children}
    </Context.Provider>
  );
}
export function useCartSession() {
  return useContext(Context)?.session ?? null;
}
export function useCartRestorationHint() {
  return useContext(Context)?.restoreOnLoad ?? true;
}
export function useCartSnapshot(session: CartSession) {
  return useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
}
