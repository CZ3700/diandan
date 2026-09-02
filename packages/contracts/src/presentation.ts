import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .brand<"Slug">();

export const publicHttpsUrlSchema = z
  .url({ protocol: /^https$/u })
  .regex(/^https:\/\/(?![^/?#]*@)/u)
  .meta({ format: "uri" })
  .brand<"PublicHttpsUrl">();

export const publicMediaViewSchema = z.strictObject({
  url: publicHttpsUrlSchema,
  alt: z.string().min(1).max(300),
});

export type PublicMediaView = z.infer<typeof publicMediaViewSchema>;
