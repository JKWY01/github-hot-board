import { ogShell } from '@/lib/og'

export const alt = 'GitHub Hot Board — live open-source leaderboards'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  await params
  return ogShell({
    title: 'GITHUB',
    accent: 'HOT BOARD',
    sub: 'Ten live leaderboards for open source — stars, slopes, milestones.',
    chips: ['All-time', 'Weekly', 'Rising', 'Milestones'],
  })
}
