import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

export interface FieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "id" | "style"
> {
  error?: ReactNode;
  hint?: ReactNode;
  id: string;
  label: ReactNode;
}

function hasContent(content: ReactNode) {
  return content !== undefined && content !== null && content !== false;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    className,
    error,
    hint,
    id,
    label,
    type = "text",
    ...props
  },
  ref,
) {
  if (id.trim().length === 0) {
    throw new TypeError("Field requires a non-empty id.");
  }
  if (typeof label === "string" && label.trim().length === 0) {
    throw new TypeError("Field requires a non-empty label.");
  }

  const hasHint = hasContent(hint);
  const hasError = hasContent(error);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const descriptionIds = [
    describedBy?.trim(),
    hasHint ? hintId : undefined,
    hasError ? errorId : undefined,
  ]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ");

  return (
    <div className="fs-field" data-invalid={hasError || undefined}>
      <label className="fs-field__label" htmlFor={id}>
        {label}
      </label>
      {hasHint ? (
        <span className="fs-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      <input
        {...props}
        ref={ref}
        aria-describedby={descriptionIds || undefined}
        aria-invalid={hasError ? true : invalid}
        className={
          className === undefined
            ? "fs-field__input"
            : `fs-field__input ${className}`
        }
        id={id}
        type={type}
      />
      {hasError ? (
        <span className="fs-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});
