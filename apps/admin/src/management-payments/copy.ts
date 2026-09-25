import type { SupportedLocale } from "@fan-support/contracts";
import { paymentEnglish } from "./copy-en";
import { paymentChinese } from "./copy-zh-cn";
import { paymentThai } from "./copy-th";
import { paymentVietnamese } from "./copy-vi";
import { paymentJapanese } from "./copy-ja";
import { paymentSpanish } from "./copy-es";
import { paymentPortuguese } from "./copy-pt";
export type { PaymentCopy } from "./copy-en";
export function paymentCopy(locale: SupportedLocale) {
  switch (locale) {
    case "en":
      return paymentEnglish;
    case "zh-CN":
      return paymentChinese;
    case "th":
      return paymentThai;
    case "vi":
      return paymentVietnamese;
    case "ja":
      return paymentJapanese;
    case "es":
      return paymentSpanish;
    case "pt":
      return paymentPortuguese;
  }
}
