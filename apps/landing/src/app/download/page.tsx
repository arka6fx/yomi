import { Download, ExternalLink, Monitor, AlertCircle } from "lucide-react"

type GitHubAsset = {
  name: string
  browser_download_url: string
  size: number
}

type GitHubRelease = {
  tag_name: string
  published_at: string
  body: string | null
  assets: GitHubAsset[]
}

async function getLatestRelease() {
  try {
    const res = await fetch('https://api.github.com/repos/arka6fx/yomi-releases/releases/latest', {
      next: { revalidate: 3600 }
    })
    
    if (!res.ok) return null
    
    const release: GitHubRelease = await res.json()
    const windowsAsset = release.assets.find((asset) => 
      asset.name.endsWith('.exe')
    )
    
    return {
      version: release.tag_name,
      downloadUrl: windowsAsset?.browser_download_url ?? 'https://github.com/arka6fx/yomi-releases/releases/latest',
      publishedAt: release.published_at,
      releaseNotes: release.body || 'No release notes available.',
      assetName: windowsAsset?.name || 'Yomi-Setup.exe',
      assetSize: windowsAsset ? `${(windowsAsset.size / 1024 / 1024).toFixed(1)} MB` : 'Unknown',
    }
  } catch {
    return null
  }
}

export default async function DownloadPage() {
  const release = await getLatestRelease()
  
  if (!release?.downloadUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center p-8">
          <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">No Downloads Available</h1>
          <p className="text-slate-600 mb-6">
            Desktop app releases haven't been published yet.
          </p>
          <a 
            href="https://github.com/arka6fx/yomi-releases/releases" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <ExternalLink className="w-5 h-5" />
            View on GitHub
          </a>
        </div>
      </div>
    )
  }
  
  const publishDate = new Date(release.publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">Download Yomi</h1>
          <p className="text-xl text-slate-600">
            Your AI-powered desktop assistant for Windows
          </p>
        </div>
        
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="flex items-start gap-6 mb-8">
            <div className="flex-shrink-0">
              <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center">
                <Monitor className="w-8 h-8 text-blue-600" />
              </div>
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Yomi for Windows
              </h2>
              <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-4">
                <span className="inline-flex items-center gap-1">
                  <span className="font-semibold">Version:</span> {release.version}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="font-semibold">Released:</span> {publishDate}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="font-semibold">Size:</span> {release.assetSize}
                </span>
              </div>
              <a
                href={release.downloadUrl}
                className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-lg shadow-lg hover:shadow-xl"
              >
                <Download className="w-6 h-6" />
                Download for Windows
              </a>
              <p className="text-sm text-slate-500 mt-3">
                Requires Windows 10 or later • 64-bit only
              </p>
            </div>
          </div>
          
          <div className="border-t border-slate-200 pt-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-3">Release Notes</h3>
            <div className="prose prose-slate max-w-none">
              <pre className="whitespace-pre-wrap text-sm text-slate-700 bg-slate-50 p-4 rounded-lg">
                {release.releaseNotes}
              </pre>
            </div>
          </div>
        </div>
        
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8">
          <div className="flex gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-2">Windows SmartScreen Warning</h3>
              <p className="text-sm text-amber-800 mb-3">
                Since Yomi is not yet code-signed, Windows SmartScreen may show a warning when you run the installer.
                This is normal for new applications.
              </p>
              <p className="text-sm text-amber-800">
                <strong>To install:</strong> Click "More info" → "Run anyway"
              </p>
            </div>
          </div>
        </div>
        
        <div className="text-center">
          <a
            href="https://github.com/arka6fx/yomi-releases/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ExternalLink className="w-5 h-5" />
            View all releases on GitHub
          </a>
        </div>
      </div>
    </div>
  )
}
