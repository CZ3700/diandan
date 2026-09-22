import type { SupportedLocale } from "@fan-support/contracts";
import { exceptionen } from "./copy-en";
import { exceptionzhCN } from "./copy-zh-cn";
import { exceptionja } from "./copy-ja";
import { exceptiones } from "./copy-es";
import { exceptionpt } from "./copy-pt";
import { exceptionvi } from "./copy-vi";
import { exceptionth } from "./copy-th";
export type { ExceptionsCopy } from "./copy-en";
export function exceptionsCopy(locale: SupportedLocale) {
  switch (locale) {
    case "en":
      return exceptionen;
    case "zh-CN":
      return exceptionzhCN;
    case "ja":
      return exceptionja;
    case "es":
      return exceptiones;
    case "pt":
      return exceptionpt;
    case "vi":
      return exceptionvi;
    case "th":
      return exceptionth;
  }
}
