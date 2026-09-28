"use client";
import { useEffect, useState } from "react";
import { Button, Icon } from "@fan-support/ui";
import type {
  ManagementCenterOperation,
  SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import type { ManagementApi } from "./api";
import { managementCopy } from "./copy";
import { managementError } from "./errors";
import { watchManagementOperation } from "./watch-operation";
import { isDismissibleOperation } from "./workspace-state";

export function OperationProgress({
  api,
  operation,
  locale,
  onChange,
  onDismiss,
}: {
  api: ManagementApi;
  operation: ManagementCenterOperation;
  locale: SupportedLocale;
  onChange: (operation: ManagementCenterOperation) => void;
  onDismiss?: () => void;
}) {
  const copy = managementCopy(locale);
  const [error, setError] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    setError(null);
    return watchManagementOperation(api, operation, onChange, setError);
  }, [api, operation, onChange, refresh]);
  const failed = operation.status === "FAILED";
  return (
    <div
      className="mc-progress"
      data-management-operation={operation.operationId}
      data-management-status={operation.status}
    >
      <p role={error || failed ? "alert" : "status"}>
        <Icon
          name={
            failed || error
              ? "warning"
              : operation.status === "PUBLISHED"
                ? "check"
                : "arrow-right"
          }
          decorative
        />
        {error
          ? managementError(error, copy)
          : failed
            ? managementError(
                new AdminClientError(
                  operation.failure?.code ?? "PUBLICATION_FAILED",
                ),
                copy,
              )
            : operation.status === "PUBLISHED"
              ? copy.published
              : copy.processing}
      </p>
      {error || (failed && operation.failure?.retryable) ? (
        <Button
          data-management-retry
          variant="secondary"
          type="button"
          disabled={retrying}
          onClick={() => {
            if (retrying) return;
            if (!failed) {
              setRefresh((value) => value + 1);
              return;
            }
            setRetrying(true);
            void api
              .retry(operation.operationId, operation.version)
              .then(onChange)
              .catch(setError)
              .finally(() => setRetrying(false));
          }}
        >
          {copy.retry}
        </Button>
      ) : failed && onDismiss && isDismissibleOperation(operation) ? (
        <Button
          data-management-dismiss
          variant="quiet"
          type="button"
          onClick={onDismiss}
        >
          {copy.dismiss}
        </Button>
      ) : null}
    </div>
  );
}
