import React from "react"

type IconProps = { size?: number }

function GmailIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4Z" fill="#EAEAEA" />
      <path d="M22 6V8.5L12 14.5L2 8.5V6L12 12L22 6Z" fill="#EA4335" />
      <path d="M22 6C22 4.9 21.1 4 20 4H18.5L22 7.5V6Z" fill="#C5221F" />
      <path d="M2 6C2 4.9 2.9 4 4 4H5.5L2 7.5V6Z" fill="#C5221F" />
    </svg>
  )
}

function GoogleCalendarIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="17" rx="2" fill="#fff" stroke="#4285F4" strokeWidth="1.5" />
      <rect x="3" y="4" width="18" height="5" rx="2" fill="#4285F4" />
      <rect x="3" y="7" width="18" height="2" fill="#4285F4" />
      <path d="M8 3v3M16 3v3" stroke="#4285F4" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="7" y="13" width="3" height="3" rx="0.5" fill="#EA4335" />
      <rect x="11" y="13" width="3" height="3" rx="0.5" fill="#FBBC04" />
      <rect x="15" y="13" width="2" height="3" rx="0.5" fill="#34A853" />
    </svg>
  )
}

function GoogleDriveIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 3L3 13.5H9L15 3H9Z" fill="#4285F4" />
      <path d="M15 3L21 13.5L18 19H12L9 13.5L15 3Z" fill="#FBBC04" />
      <path d="M3 13.5L6 19H18L21 13.5H3Z" fill="#34A853" />
    </svg>
  )
}

function GitHubIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.164 22 16.416 22 12c0-5.523-4.477-10-10-10z" fill="#CCCCCC" />
    </svg>
  )
}

function NotionIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M4.8 3h14.4c1 0 1.8.8 1.8 1.8v14.4c0 1-.8 1.8-1.8 1.8H4.8C3.8 21 3 20.2 3 19.2V4.8C3 3.8 3.8 3 4.8 3zm2.7 3.6h1.8v8.4l4.5-8.4h1.8v10.8h-1.8V7.8l-4.5 8.4H7.5V6.6z" fill="#CCCCCC" />
    </svg>
  )
}

function SlackIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 127 127" fill="none">
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A" />
      <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0" />
      <path d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z" fill="#2EB67D" />
      <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E" />
    </svg>
  )
}

function LinearIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857l36.5099 36.5099c.6889.6889.0915 1.8189-.857 1.5964C20.8515 94.4, 5.5966 79.1369 1.22541 61.5228z" fill="#5E6AD2"/>
      <path d="M.00189154 46.8891c-.01764375 1.1114.29971 2.1476.89338 2.9995L96.6018 146.6c.8519-.5937 1.8881-.9113 2.9995-.8938-.2232-29.9885-24.5086-54.2739-54.4971-54.4971z" fill="#5E6AD2"/>
      <path d="M50.0003 4.7438c-1.7038-.00182-3.3979.0623-5.0793.19205L96.4067 56.3797c.1297-1.6814.1938-3.3755.1919-5.0793 0-25.7662-20.7624-46.5286-46.5283-46.5566z" fill="#5E6AD2"/>
      <path d="M20.3143 11.5057c-2.7754 1.8623-5.3622 4.0046-7.7035 6.3459l69.5376 69.5376c2.3413-2.3413 4.4836-4.9281 6.3459-7.7035L20.3143 11.5057z" fill="#5E6AD2"/>
      <path d="M4.79388 31.6952c-1.54797 3.2365-2.68851 6.6563-3.37997 10.2099L61.3951 100.084c3.5536-.6915 6.9734-1.832 10.2099-3.38L4.79388 31.6952z" fill="#5E6AD2"/>
    </svg>
  )
}

function PostgresIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="7" rx="9" ry="4" fill="#336791" />
      <path d="M3 7v10c0 2.21 4.03 4 9 4s9-1.79 9-4V7" stroke="#336791" strokeWidth="1.5" fill="none" />
      <path d="M21 12c0 2.21-4.03 4-9 4S3 14.21 3 12" stroke="#336791" strokeWidth="1.5" fill="none" />
      <ellipse cx="12" cy="7" rx="9" ry="4" fill="none" stroke="#4a90d9" strokeWidth="1.5" />
    </svg>
  )
}

function MySQLIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3C7.03 3 3 5.24 3 8s4.03 5 9 5 9-2.24 9-5-4.03-5-9-5z" fill="#F29111" />
      <path d="M3 8v4c0 2.76 4.03 5 9 5s9-2.24 9-5V8" stroke="#F29111" strokeWidth="1.5" fill="none" />
      <path d="M3 12v4c0 2.76 4.03 5 9 5s9-2.24 9-5v-4" stroke="#F29111" strokeWidth="1" fill="none" />
    </svg>
  )
}

function FallbackIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="#CCCCCC" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" fill="#CCCCCC" />
    </svg>
  )
}

const ICON_MAP: Record<string, React.FC<IconProps>> = {
  google: GmailIcon,
  gmail: GmailIcon,
  "google-calendar": GoogleCalendarIcon,
  "google-drive": GoogleDriveIcon,
  github: GitHubIcon,
  notion: NotionIcon,
  slack: SlackIcon,
  linear: LinearIcon,
  "linear-api-key": LinearIcon,
  postgres: PostgresIcon,
  mysql: MySQLIcon,
}

export function ConnectorIcon({ id, size = 24 }: { id: string; size?: number }) {
  const Icon = ICON_MAP[id.toLowerCase()] ?? FallbackIcon
  return <Icon size={size} />
}
