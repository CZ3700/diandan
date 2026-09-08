import type { SupportedLocale } from "@fan-support/contracts";
import { copy as en } from "./copy-en";
import { copy as zhcn } from "./copy-zh-cn";
import { copy as th } from "./copy-th";
import { copy as vi } from "./copy-vi";
import { copy as ja } from "./copy-ja";
import { copy as es } from "./copy-es";
import { copy as pt } from "./copy-pt";

export type ManagementCopy = { [Key in keyof typeof en]: string };
export function managementCopy(locale: SupportedLocale): ManagementCopy {
  switch (locale) {
    case "en":
      return en;
    case "zh-CN":
      return zhcn;
    case "th":
      return th;
    case "vi":
      return vi;
    case "ja":
      return ja;
    case "es":
      return es;
    case "pt":
      return pt;
  }
}
