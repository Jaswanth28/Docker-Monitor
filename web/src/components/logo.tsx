/** Hard-hat mark: a dock/container-yard helmet with a small status lamp, for the "Docker Monitor" wordmark. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label="Docker Monitor">
      <rect width="32" height="32" rx="8" fill="url(#dm-logo-grad)" />
      {/* brim */}
      <rect x="5" y="20.5" width="22" height="3.4" rx="1.7" fill="white" fillOpacity="0.95" />
      {/* dome */}
      <path d="M16 8.2c-4.7 0-8.5 3.7-8.5 8.3v3.4h17v-3.4c0-4.6-3.8-8.3-8.5-8.3Z" fill="white" />
      {/* center ridge */}
      <path d="M16 8.2v11.7" stroke="url(#dm-logo-grad)" strokeWidth="1.1" strokeLinecap="round" opacity="0.35" />
      {/* status lamp */}
      <circle cx="16" cy="13.6" r="2.6" fill="#0ca30c" />
      <circle cx="16" cy="13.6" r="2.6" stroke="white" strokeWidth="1" />
      <defs>
        <linearGradient id="dm-logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3987e5" />
          <stop offset="1" stopColor="#184f95" />
        </linearGradient>
      </defs>
    </svg>
  )
}
