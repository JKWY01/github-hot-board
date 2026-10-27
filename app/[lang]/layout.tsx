import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Analytics } from '@vercel/analytics/react'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

import '../globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import NavProgress from '@/components/NavProgress'
import BackToTop from '@/components/BackToTop'
import { getDict, isLocale } from './dictionaries'
import { LOCALE_HTML_LANG } from '@/lib/locales'

export async function generateMetadata({ params }: LayoutProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  const dict = getDict(lang)
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: {
      default: dict.meta.homeTitle,
      template: `%s · ${dict.meta.siteName}`,
    },
    description: dict.meta.homeDescription,
    applicationName: dict.meta.siteName,
    robots: { index: true, follow: true },
    alternates: {
      types: { 'application/rss+xml': `${BASE}/feed.xml` },
    },
  }
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<'/[lang]'>) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()
  const dict = getDict(lang)

  return (
    <html lang={LOCALE_HTML_LANG[lang]}>
      <body className="flex min-h-screen flex-col bg-white text-ink antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.classList.add('js');" +
              // 主题防闪:首访跟随系统,此后读 localStorage(与 ThemeToggle 同一约定)
              "try{var t=localStorage.getItem('ghb.theme');" +
              "if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <NavProgress />
        <Nav locale={dict.locale} />
        <main className="min-h-[70vh] flex-1">{children}</main>
        <Footer dict={dict} />
        <BackToTop />
        {/* 匿名页面访问统计(Vercel 托管、免 Cookie、不收个人信息)—— 验证周期的眼睛。
            HK 自托管线(NEXT_PUBLIC_ANALYTICS=off,deploy-hk 构建时注入)不加载:
            非 Vercel 运行时 beacon 全部 404(实测 6 天 9800+ 次空转),access.log 才是权威。 */}
        {process.env.NEXT_PUBLIC_ANALYTICS !== 'off' && <Analytics />}
      </body>
    </html>
  )
}
