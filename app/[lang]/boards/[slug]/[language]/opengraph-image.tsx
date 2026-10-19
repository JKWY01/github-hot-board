import { DICT } from '@/app/[lang]/dictionaries'
import { isBoardSlug, facetDisplay, facetLangFromSlug, type BoardSlug } from '@/lib/boards'
import { ogShell } from '@/lib/og'

export const alt = 'GitHub Hot Board — language board preview'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function BoardLanguageImage({
  params,
}: {
  params: Promise<{ lang: string; slug: string; language: string }>
}) {
  const { slug, language: slugParam } = await params
  const language = facetLangFromSlug(slugParam)
  if (!isBoardSlug(slug) || !language) {
    return ogShell({
      title: 'GITHUB',
      accent: 'HOT BOARD',
      sub: 'Live leaderboards for open source.',
      chips: [],
    })
  }
  const copy = DICT.en.boards[slug as BoardSlug]
  const display = facetDisplay(language)
  return ogShell({
    title: 'GITHUB',
    accent: `${copy.name.toUpperCase()} · ${display.toUpperCase()}`,
    sub: copy.tagline,
    chips: [display.toUpperCase(), copy.metricLabel.toUpperCase(), 'LIVE · 60S REFRESH'],
  })
}
