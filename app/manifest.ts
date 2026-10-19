import type { MetadataRoute } from 'next'

import { DICT } from '@/app/[lang]/dictionaries'

export default function manifest(): MetadataRoute.Manifest {
  const zh = DICT.zh
  return {
    name: zh.meta.siteName,
    short_name: zh.meta.siteName.replace('GitHub ', ''),
    description: zh.meta.homeDescription,
    start_url: '/zh',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [{ src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
  }
}
