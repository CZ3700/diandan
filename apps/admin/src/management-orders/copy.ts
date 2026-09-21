import type { SupportedLocale } from "@fan-support/contracts";
import { copy as en } from "./copy-en";
import { copy as zhcn } from "./copy-zh-cn";
import { copy as ja } from "./copy-ja";
import { copy as es } from "./copy-es";
import { copy as pt } from "./copy-pt";
import { copy as vi } from "./copy-vi";
import { copy as th } from "./copy-th";
export type OrdersCopy = { [Key in keyof typeof en]: string };
export function ordersCopy(locale: SupportedLocale): OrdersCopy {
  switch (locale) {
    case "en":
      return en;
    case "zh-CN":
      return zhcn;
    case "ja":
      return ja;
    case "es":
      return es;
    case "pt":
      return pt;
    case "vi":
      return vi;
    case "th":
      return th;
  }
}
