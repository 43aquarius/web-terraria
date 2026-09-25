import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Baloo_2, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** 泰拉瑞亚 UI 字体(原作 Andy Bold 的近似替代, 圆润粗体; 中文回退 Noto Sans SC) */
const baloo2 = Baloo_2({
  variable: "--font-andy",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-cjk",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

export const metadata: Metadata = {
  title: "泰拉瑞亚 Web · Terraria Clone",
  description: "基于 Next.js 与 Canvas 的泰拉瑞亚 Web 复刻版：程序化生成的像素世界，挖掘、建造、合成、战斗与昼夜循环，致敬 Re-Logic 的伟大作品。",
  keywords: ["Z.ai", "Next.js", "TypeScript", "Tailwind CSS", "shadcn/ui", "AI development", "React"],
  authors: [{ name: "Z.ai Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Z.ai Code Scaffold",
    description: "AI-powered development with modern React stack",
    url: "https://chat.z.ai",
    siteName: "Z.ai",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Z.ai Code Scaffold",
    description: "AI-powered development with modern React stack",
  },
};

/**
 * 移动端视口(12-c):
 * - device-width + initialScale=1: 消除移动浏览器 ~980px 虚拟视口整体缩放(画面比例错乱/人物跑出画面的主因)
 * - userScalable=false + maximumScale=1: 禁双指缩放(游戏画布自带触摸交互)
 * - viewportFit=cover: 铺满刘海屏, 配合 env(safe-area-inset-*) 避让安全区
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${baloo2.variable} ${notoSansSC.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
