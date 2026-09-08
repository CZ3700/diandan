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
const Context = createContext<CartSession | null>(null);
export function CartProvider({
  locale,
  children,
}: Readonly<{ locale: SupportedLocale; children: ReactNode }>) {
  const [session] = useState(() => createCartSession(locale));
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useCartSession() {
  return useContext(Context);
}
export function useCartSnapshot(session: CartSession) {
  return useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
}
