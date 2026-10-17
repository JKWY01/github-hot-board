export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#1d1d1f" />
      <path
        d="M12 5.6l1.85 3.75 4.15.6-3 2.93.71 4.13L12 15.03l-3.71 1.95.71-4.13-3-2.93 4.14-.6L12 5.6z"
        fill="#ffffff"
      />
    </svg>
  )
}

export function StarIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 1.6l2 4.06 4.5.66-3.25 3.17.77 4.47L8 11.83l-4.02 2.13.77-4.47L1.5 6.32l4.5-.66L8 1.6z" />
    </svg>
  )
}

export function ForkIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
      <circle cx="4.2" cy="3.6" r="1.6" />
      <circle cx="11.8" cy="3.6" r="1.6" />
      <circle cx="8" cy="12.4" r="1.6" />
      <path d="M4.2 5.2v.6c0 1.6 1.3 2.9 2.9 2.9h1.8c1.6 0 2.9-1.3 2.9-2.9v-.6M8 8.7v2.1" strokeLinecap="round" />
    </svg>
  )
}

export function IssueIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <circle cx="8" cy="10.4" r="0.9" fill="currentColor" stroke="none" />
      <path d="M6.4 5.2c.2-.9 1-1.5 1.9-1.3 1 .2 1.5 1.1 1.3 2-.2.8-.9 1.2-1.6 1.5-.5.2-.8.6-.8 1.1" strokeLinecap="round" />
    </svg>
  )
}

export function ClockIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.6V8l2.3 1.6" strokeLinecap="round" />
    </svg>
  )
}

export function ArrowUpIcon({ size = 10, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4 0l4 7H0z" />
    </svg>
  )
}

export function ArrowDownIcon({ size = 10, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4 8L0 1h8z" />
    </svg>
  )
}

export function GlobeIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M1.8 8h12.4M8 1.7c2 2.1 2.9 4.3 2.9 6.3S10 12.2 8 14.3C6 12.2 5.1 10 5.1 8S6 3.8 8 1.7Z" />
    </svg>
  )
}

export function GithubIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}
