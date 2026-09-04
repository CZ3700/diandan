"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { useCallback, type ReactElement, type ReactNode } from "react";

import { Icon } from "./icon.js";

export type ToastMessage = Readonly<{
  description?: string;
  id?: string;
  priority?: "high" | "low";
  timeout?: number;
  title: string;
}>;

export type ToastController = Readonly<{
  dismiss: (id?: string) => void;
  notify: (message: ToastMessage) => string;
}>;

export type ToastProviderProps = Readonly<{
  children: ReactNode;
  closeLabel: string;
  limit?: number;
  timeout?: number;
  viewportLabel: string;
}>;

function ToastList({
  closeLabel,
}: Readonly<{ closeLabel: string }>): ReactElement {
  const { toasts } = ToastPrimitive.useToastManager();

  return (
    <>
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          className="fs-toast"
          key={toast.id}
          swipeDirection="down"
          toast={toast}
        >
          <ToastPrimitive.Content className="fs-toast__content">
            <div className="fs-toast__copy">
              <ToastPrimitive.Title className="fs-toast__title" />
              {toast.description === undefined ? null : (
                <ToastPrimitive.Description className="fs-toast__description" />
              )}
            </div>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              className="fs-toast__close"
            >
              <Icon className="fs-interaction-icon" decorative name="close" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Content>
        </ToastPrimitive.Root>
      ))}
    </>
  );
}

export function ToastProvider({
  children,
  closeLabel,
  limit = 3,
  timeout = 5_000,
  viewportLabel,
}: ToastProviderProps): ReactElement {
  if (closeLabel.trim() === "" || viewportLabel.trim() === "") {
    throw new TypeError("Toast close and viewport labels are required");
  }

  return (
    <ToastPrimitive.Provider limit={limit} timeout={timeout}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          aria-label={viewportLabel}
          className="fs-toast__viewport"
        >
          <ToastList closeLabel={closeLabel} />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

export function useToast(): ToastController {
  const manager = ToastPrimitive.useToastManager();
  const dismiss = useCallback(
    (id?: string) => {
      manager.close(id);
    },
    [manager],
  );
  const notify = useCallback(
    (message: ToastMessage) => manager.add(message),
    [manager],
  );

  return { dismiss, notify };
}
