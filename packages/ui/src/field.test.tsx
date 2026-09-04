import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Field, type FieldProps } from "./field.js";

describe("Field", () => {
  test("connects a stable native input to its visible label", () => {
    const markup = renderToStaticMarkup(
      <Field id="contact-email" label="Email" name="email" required />,
    );

    expect(markup).toMatch(/<label\b[^>]*for="contact-email"/u);
    expect(markup).toContain('id="contact-email"');
    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="text"');
    expect(markup).toContain("required");
    expect(markup).toContain('class="fs-field__input"');
    expect(markup).not.toContain("aria-describedby");
    expect(markup).not.toContain("aria-invalid");
  });

  test("merges caller, hint, and error descriptions while forcing invalid state", () => {
    const hint =
      "Usaremos este correo exclusivamente para enviarte el enlace seguro del pedido.";
    const error = "Introduce una dirección de correo válida.";
    const markup = renderToStaticMarkup(
      <Field
        aria-describedby="checkout-context"
        aria-invalid={false}
        className="checkout-email"
        error={error}
        hint={hint}
        id="contact-email"
        label="Correo electrónico de contacto"
      />,
    );

    expect(markup).toContain(
      'aria-describedby="checkout-context contact-email-hint contact-email-error"',
    );
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('id="contact-email-hint"');
    expect(markup).toContain('id="contact-email-error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("checkout-email");
    expect(markup).toContain(hint);
    expect(markup).toContain(error);
  });

  test("preserves caller invalid state when no local error copy is supplied", () => {
    const markup = renderToStaticMarkup(
      <Field aria-invalid="grammar" id="display-name" label="Display name" />,
    );

    expect(markup).toContain('aria-invalid="grammar"');
    expect(markup).not.toContain("fs-field__error");
  });

  test("rejects an empty stable id", () => {
    expect(() =>
      renderToStaticMarkup(<Field id="   " label="Email" />),
    ).toThrow(/non-empty id/u);
  });

  test("rejects an empty string label", () => {
    expect(() =>
      renderToStaticMarkup(<Field id="email" label="   " />),
    ).toThrow(/non-empty label/u);
  });
});

// @ts-expect-error A stable field id is required for the label relationship.
const missingFieldId: FieldProps = { label: "Email" };
void missingFieldId;

// @ts-expect-error A visible localized label is required.
const missingFieldLabel: FieldProps = { id: "email" };
void missingFieldLabel;

const inlineStyleField: FieldProps = {
  id: "email",
  label: "Email",
  // @ts-expect-error Inline styles bypass the shared design-token boundary.
  style: { color: "red" },
};
void inlineStyleField;
