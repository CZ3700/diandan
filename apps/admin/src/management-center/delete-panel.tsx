"use client";
import { useState } from "react";
import { Button } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import { managementCopy } from "./copy";
import { deleteNameConfirmed } from "./delete-model";

/** Permanent delete with a typed-name confirmation; the page offers no undo. */
export function DeletePanel({
  locale,
  name,
  nameLocale,
  disabled,
  onDelete,
}: {
  locale: SupportedLocale;
  name: string;
  nameLocale: SupportedLocale;
  disabled: boolean;
  onDelete: () => void;
}) {
  const copy = managementCopy(locale);
  const [typed, setTyped] = useState("");
  const confirmed = deleteNameConfirmed(typed, name);
  return (
    <section
      className="mc-delete"
      aria-labelledby="management-delete-title"
      data-management-delete
    >
      <h2 id="management-delete-title">{copy.deleteTitle}</h2>
      <p>{copy.deleteWarning}</p>
      <div className="mc-field">
        <label htmlFor="management-delete-name">
          {copy.deleteTypeName}
          {": "}
          <strong lang={nameLocale}>{name}</strong>
        </label>
        <input
          id="management-delete-name"
          data-management-delete-name
          value={typed}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
      </div>
      <Button
        type="button"
        variant="danger"
        data-management-delete-confirm
        disabled={disabled || !confirmed}
        onClick={onDelete}
      >
        {copy.deleteConfirm}
      </Button>
    </section>
  );
}
