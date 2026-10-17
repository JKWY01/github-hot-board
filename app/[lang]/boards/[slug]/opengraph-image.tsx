import { DICT } from '@/app/[lang]/dictionaries'
import { isBoardSlug, type BoardSlug } from '@/lib/boards'
import { ogShell } from '@/lib/og'

export const alt = 'GitHub Hot Board — board preview'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function BoardImage({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>
}) {
  const { lang, slug } = await params
  void lang
  if (!isBoardSlug(slug)) {
    return ogShell({
      title: 'GITHUB',
      accent: 'HOT BOARD',
      sub: 'Live leaderboards for open source.',
      chips: [],
    })
  }
  const copy = DICT.en.boards[slug as BoardSlug]
  return ogShell({
    title: 'GITHUB',
    accent: copy.name.toUpperCase(),
    sub: copy.tagline,
    chips: [copy.metricLabel.toUpperCase(), 'LIVE · 60S REFRESH'],
  })
}
