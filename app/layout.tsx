import type { Metadata } from "next";
import { headers } from "next/headers";
import { LocaleProvider } from "../lib/locale-provider.tsx";
import { preferredLocale } from "../lib/locale.ts";
import "./globals.css";

async function requestLocale() {
  return preferredLocale((await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: "Openjutsu",
    description: locale === "zh-CN"
      ? "基于 ComfyUI 和 MiniMax H3 的开源视频角色替换工具。"
      : "Open-source character swap for video, powered by ComfyUI and MiniMax H3.",
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <body><LocaleProvider locale={locale}>{children}</LocaleProvider></body>
    </html>
  );
}
