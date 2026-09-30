"use client";

import { createContext } from "react";

/**
 * The `data-gift-nav` target of the choice a fan just made, while its result is still
 * loading. The toolbar shows that choice as selected straight away.
 */
export const GiftNavigationPending = createContext<string | undefined>(
  undefined,
);
