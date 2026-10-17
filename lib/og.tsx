import { ImageResponse } from 'next/og'

export const OG_SIZE = { width: 1200, height: 630 }

/** Open Graph 分享图模板（satori 渲染，仅用英文以保证字体覆盖）。 */
export function ogShell({
  title,
  accent,
  sub,
  chips,
}: {
  title: string
  accent: string
  sub: string
  chips: string[]
}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: 'linear-gradient(135deg, #0b0b0f 0%, #12121a 60%, #0b0b0f 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: 'linear-gradient(135deg, #0071e3, #7a4dd6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
          <div style={{ fontSize: 23, letterSpacing: 6, color: 'rgba(255,255,255,0.6)' }}>
            GITHUB / LIVE OPEN-SOURCE PULSE
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, letterSpacing: -2 }}>
            <span style={{ color: 'rgba(255,255,255,0.92)' }}>{title} </span>
            <span
              style={{
                background: 'linear-gradient(90deg, #0071e3, #7a4dd6)',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {accent}
            </span>
          </div>
          <div style={{ marginTop: 20, fontSize: 30, color: 'rgba(255,255,255,0.65)', maxWidth: 920 }}>
            {sub}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          {chips.map((chip) => (
            <div
              key={chip}
              style={{
                padding: '10px 22px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.22)',
                fontSize: 22,
                color: 'rgba(255,255,255,0.82)',
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE,
  )
}
