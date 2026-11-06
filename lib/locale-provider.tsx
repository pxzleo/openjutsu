"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { Locale } from "./locale.ts";
import { localizedError } from "./locale-errors.ts";

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return useCallback((english: string, chinese: string) => locale === "zh-CN" ? chinese : english, [locale]);
}

export function useErrorText() {
  const locale = useLocale();
  return useCallback((message: string) => localizedError(message, locale), [locale]);
}
