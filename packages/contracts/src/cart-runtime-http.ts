import { z } from "zod";
import {
  cartRuntimeAddCommandSchema,
  cartRuntimeInitializeCommandSchema,
} from "./cart-runtime.js";

export const cartRuntimeInitializeRequestSchema =
  cartRuntimeInitializeCommandSchema.omit({ operation: true });
export const cartRuntimeAddRequestSchema = z.union([
  cartRuntimeAddCommandSchema.options[0].omit({ operation: true }),
  cartRuntimeAddCommandSchema.options[1].omit({ operation: true }),
]);
