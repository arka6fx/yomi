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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#5E6AD2">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0ZM6.4 16.8l1.6 1.6A10.38 10.38 0 0 1 5.73 16.14ZM4.835 14.165l4.8 4.8a10.01 10.01 0 0 1-1.43.343L4.4 14.2a9.966 9.966 0 0 1 .435-2.035ZM4 12c0-.143.004-.286.012-.428L12.428 20a10.01 10.01 0 0 1-1.535-.177L4.177 13.107A9.975 9.975 0 0 1 4 12zm1.4-3.2 10.8 10.8c-.533.25-1.09.45-1.663.599L5.001 9.663A10.004 10.004 0 0 1 5.4 8.8zm2.4-2.4L18.4 17c-.353.4-.74.764-1.15 1.092L6.308 7.15C6.636 6.74 7 6.353 7.8 6.4zm4-2.8a10.01 10.01 0 0 1 2.035.435l4.808 4.808A9.977 9.977 0 0 1 19 12l-.428-.428-6.764-6.764A10.01 10.01 0 0 1 11.8 3.6zm-1.428.012L20 13.228A10.01 10.01 0 0 0 19.4 11.4l-9-9a10.01 10.01 0 0 0-1.828-.6Z"/>
    </svg>
  )
}

function DiscordIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.01.043.027.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
        fill="#5865F2"
      />
    </svg>
  )
}

function TelegramIcon({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
        fill="#26A5E4"
      />
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
  discord: DiscordIcon,
  "discord-connector": DiscordIcon,
  telegram: TelegramIcon,
  postgres: PostgresIcon,
  mysql: MySQLIcon,
}

export function ConnectorIcon({ id, size = 24 }: { id: string; size?: number }) {
  const Icon = ICON_MAP[id.toLowerCase()] ?? FallbackIcon
  return <Icon size={size} />
}
