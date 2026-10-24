import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { getDict, isLocale } from '../dictionaries'
import { LOCALES, altLangs } from '@/lib/locales'
import { guideFor } from '@/lib/guide'
import { jsonLdScript } from '@/lib/jsonld'

/** 纯静态内容页(无动态 IO):16 语各自 bake,SEO 长尾主战场。 */
export async function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  const g = guideFor(lang)
  return {
    title: g.metaTitle,
    description: g.metaDesc,
    alternates: {
      canonical: `/${lang}/guide`,
      languages: altLangs('/guide'),
    },
    openGraph: {
      type: 'article',
      url: `/${lang}/guide`,
      title: g.metaTitle,
      description: g.metaDesc,
    },
  }
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()
  const dict = getDict(lang)
  const locale = dict.locale
  const g = guideFor(lang)

  return (
    <div>
      {/* 开篇 */}
      <section className="mx-auto max-w-3xl px-5 pb-10 pt-16 sm:px-6 sm:pt-24">
        <p className="kicker rise" style={{ '--rise-delay': '40ms' } as React.CSSProperties}>
          {g.kicker}
        </p>
        <h1 className="rise mt-3 text-[30px] font-semibold leading-tight tracking-tight text-ink sm:text-[38px]">
          {g.h1}
        </h1>
        <p
          className="rise mt-6 text-[16px] leading-relaxed text-sub"
          style={{ '--rise-delay': '140ms' } as React.CSSProperties}
        >
          {g.lead1}
        </p>
        <p
          className="rise mt-4 text-[16px] leading-relaxed text-sub"
          style={{ '--rise-delay': '200ms' } as React.CSSProperties}
        >
          {g.lead2}
        </p>
      </section>

      {/* 十榜阵:每张榜一段内链(榜名 + 口径简语),全量走字典的译名 */}
      <section className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        <p className="kicker">{g.boardsKicker}</p>
        <h2 className="section-title mt-1.5">{g.boardsTitle}</h2>
        <ul className="mt-7 divide-y-[0.5px] divide-black/10 rounded-[22px] border-[0.5px] border-black/10 bg-white">
          {(Object.keys(dict.boards) as Array<keyof typeof dict.boards>).map((slug, index) => (
            <li key={slug}>
              <Link
                href={`/${locale}/boards/${slug}`}
                prefetch={false}
                className="group flex items-baseline justify-between gap-4 px-6 py-4 transition-colors hover:bg-surface"
              >
                <span className="min-w-0">
                  <span className="mr-2.5 text-[12px] font-semibold tabular-nums text-sub">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[15.5px] font-semibold tracking-tight text-ink group-hover:text-accent">
                    {dict.boards[slug].name}
                  </span>
                  <span className="ml-2.5 hidden text-[12.5px] text-sub sm:inline">
                    {dict.boards[slug].metricLabel}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* 问答(可见正文 + FAQPage 结构化数据同源) */}
      <section className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
        <h2 className="section-title">{dict.ui.openQuestions}</h2>
        <div className="mt-6 space-y-7">
          {g.faqs.map((faq) => (
            <div key={faq.q}>
              <h3 className="text-[15.5px] font-semibold text-ink">{faq.q}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-sub">{faq.a}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 border-t-[0.5px] border-black/10 pt-6 text-[13px] leading-relaxed text-sub">
          {g.footerLine}
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            inLanguage: lang,
            mainEntity: g.faqs.map(({ q, a }) => ({
              '@type': 'Question',
              name: q,
              acceptedAnswer: { '@type': 'Answer', text: a },
            })),
          }),
        }}
      />
    </div>
  )
}
