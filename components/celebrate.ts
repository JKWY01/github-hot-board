'use client'

const COLORS = ['#0071e3', '#7a4dd6', '#248a3d', '#b25000', '#e6b800', '#1d1d1f']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotate: number
  vr: number
  color: string
  delay: number
}

/** 在指定矩形位置爆一次五彩纸屑（纯图形，无 emoji；尊重 prefers-reduced-motion）。 */
export function celebrateBurst(anchor?: DOMRect | null, strength = 1): void {
  if (typeof window === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const canvas = document.createElement('canvas')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
    zIndex: '9999',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  ctx?.scale(dpr, dpr)

  const cx = anchor ? anchor.left + anchor.width / 2 : width / 2
  const cy = anchor ? anchor.top + anchor.height / 4 : height * 0.7

  const particles: Particle[] = Array.from({ length: Math.round(30 * strength) }, () => ({
    x: cx + (Math.random() - 0.5) * Math.max(60, (anchor?.width ?? 300) * 0.7),
    y: cy + Math.random() * 8,
    vx: (Math.random() - 0.5) * 5.2,
    vy: -(4.5 + Math.random() * 5.5),
    size: 3 + Math.random() * 4.5,
    rotate: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.35,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 120,
  }))

  const started = performance.now()
  let frame = 0

  const tick = (now: number) => {
    const elapsed = now - started
    ctx?.clearRect(0, 0, width, height)
    let alive = false
    for (const p of particles) {
      const life = elapsed - p.delay
      if (life < 0) {
        alive = true
        continue
      }
      const t = life / 1500
      if (t >= 1) continue
      alive = true
      const px = p.x + p.vx * (elapsed / 16)
      const py = p.y + p.vy * (elapsed / 16) + 0.0135 * (elapsed / 16) * 0.5 * (elapsed / 16)
      const alpha = 1 - t * t
      if (ctx) {
        ctx.save()
        ctx.globalAlpha = Math.max(0, alpha)
        ctx.translate(px, py)
        ctx.rotate(p.rotate + p.vr * t * 12)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.58)
        ctx.restore()
      }
    }
    if (alive && elapsed < 2400) {
      frame = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(frame)
      canvas.remove()
    }
  }
  frame = requestAnimationFrame(tick)
}
