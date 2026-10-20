import type { MetadataRoute } from 'next'

import { DICT } from '@/app/[lang]/dictionaries'

export default function manifest(): MetadataRoute.Manifest {
  // PWA 清单跟随默认语言(站点默认英文)
  const en = DICT.en
  return {
    name: en.meta.siteName,
    short_name: en.meta.siteName.replace('GitHub ', ''),
    description: en.meta.homeDescription,
    start_url: '/en',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [{ src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
  }
}
