import type { SupportedLocale } from "@fan-support/contracts";
import { copy as en } from "./copy-en";
import { copy as zh } from "./copy-zh-cn";
import { copy as ja } from "./copy-ja";
import { copy as th } from "./copy-th";
import { copy as vi } from "./copy-vi";
import { copy as es } from "./copy-es";
import { copy as pt } from "./copy-pt";
export type FinanceCopy = { [Key in keyof typeof en]: string };
export function financeCopy(locale: SupportedLocale): FinanceCopy {
  switch (locale) {
    case "en":
      return en;
    case "zh-CN":
      return zh;
    case "ja":
      return ja;
    case "th":
      return th;
    case "vi":
      return vi;
    case "es":
      return es;
    case "pt":
      return pt;
  }
}
