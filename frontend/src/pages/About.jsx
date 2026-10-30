import { ExternalLink, Github, Info, RefreshCw, Rocket, Zap } from "lucide-react";

export default function About({ version, onCheckUpdate, checkingUpdate }) {
  const apiEndpoints = [
    { label: "OpenAI format", value: `${window.location.origin}/v1/chat/completions` },
    { label: "Gemini format", value: `${window.location.origin}/v1beta/models` },
    { label: "Claude format", value: `${window.location.origin}/v1/messages` },
  ];

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-6">
      {/* API endpoints */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
          <Zap size={16} className="text-amber-400" />
          API endpoints (click to copy)
        </h3>
        <div className="space-y-2">
          {apiEndpoints.map((ep) => (
            <div key={ep.label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm">
              <span className="text-gray-500 sm:w-24 flex-shrink-0">{ep.label}</span>
              <code
                className="bg-dark-800 border border-dark-600 rounded px-2 py-1 text-xs text-gray-300 cursor-pointer hover:text-white break-all"
                onClick={() => copyText(ep.value)}
              >
                {ep.value}
              </code>
            </div>
          ))}
        </div>
      </div>

      {/* Project overview */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-purple-600/20">
            <Rocket className="w-7 h-7 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">AGY2API</h2>
            <p className="text-gray-400 text-sm">
              {version?.version ? `Version: ${version.version}` : "Antigravity API proxy service"}
            </p>
          </div>
        </div>
        <p className="text-gray-400 text-sm leading-relaxed">
          A proxy that converts the Google Antigravity API into OpenAI-, Gemini- and Anthropic-
          compatible formats. Supports multi-account management (deduplicated by email), automatic rotation, per-model cooldowns, and credential import/export.
        </p>
        <div className="flex flex-wrap items-center gap-4 mt-4">
          <a
            href="https://github.com/su-kaka/agy2api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 text-sm flex items-center gap-1.5"
          >
            <Github size={15} />
            GitHub repository
            <ExternalLink size={12} />
          </a>
          <button
            onClick={onCheckUpdate}
            disabled={checkingUpdate}
            className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            {checkingUpdate ? (
              <Info size={14} className="animate-pulse" />
            ) : (
              <RefreshCw size={14} />
            )}
            {checkingUpdate ? "Checking..." : "Check for updates"}
          </button>
          {version?.check_update && version?.has_update && (
            <span className="text-emerald-400 text-sm flex items-center gap-1.5">
              <Info size={14} />
              New version available: {version.latest_version}
            </span>
          )}
          {version?.check_update && version?.has_update === false && (
            <span className="text-gray-400 text-sm flex items-center gap-1.5">
              <Info size={14} />
              You are on the latest version
            </span>
          )}
        </div>
      </div>

      {/* Key features */}
      <div className="card">
        <h3 className="text-lg font-semibold text-blue-400 mb-4">✨ Key features</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-3">
            <div className="text-gray-300">
              <span className="text-amber-400">⚡</span>{" "}
              <strong>Multi-format: </strong>OpenAI / Gemini / Anthropic API formats
            </div>
            <div className="text-gray-300">
              <span className="text-cyan-400">🔄</span>{" "}
              <strong>Automatic rotation: </strong>random load balancing that skips cooling-down and disabled credentials
            </div>
            <div className="text-gray-300">
              <span className="text-emerald-400">🛡️</span>{" "}
              <strong>Auto-ban: </strong>automatically disables failing credentials on configured error codes
            </div>
            <div className="text-gray-300">
              <span className="text-purple-400">❄️</span>{" "}
              <strong>Per-model cooldown: </strong>a 429 error sets a cooldown for that model
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-gray-300">
              <span className="text-red-400">✂️</span>{" "}
              <strong>Anti-truncation: </strong>models prefixed with "抗截断-" automatically continue truncated responses
            </div>
            <div className="text-gray-300">
              <span className="text-emerald-400">📊</span>{" "}
              <strong>Live monitoring: </strong>credential status, error codes and quota lookup
            </div>
            <div className="text-gray-300">
              <span className="text-gray-400">📱</span>{" "}
              <strong>Responsive UI: </strong>adapts to desktop and mobile
            </div>
          </div>
        </div>
      </div>

      {/* Community group */}
      <div className="card text-center">
        <h3 className="text-lg font-semibold text-blue-400 mb-4">💬 Community group</h3>
        <p className="text-gray-400 text-sm mb-3">Join the upstream QQ group to discuss the project!</p>
        <div className="inline-block bg-white rounded-xl p-3">
          <img
            src="/docs/qq-group.jpg"
            alt="QQ group QR code"
            className="w-40 h-40 rounded-lg"
          />
        </div>
        <p className="text-blue-400 font-semibold mt-3">QQ group number: 1083250744</p>
      </div>

      {/* Usage notice */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
        <div className="text-amber-400 font-medium mb-2">⚠️ Usage notice</div>
        <p className="text-sm text-amber-400/80">
          This project is for learning and research only. Commercial use and resale are prohibited.
        </p>
      </div>

      {/* Version info */}
      {version && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-300 mb-3">Version info</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="text-gray-500">
              Current version: <span className="text-gray-300">{version.version || "-"}</span>
            </div>
            <div className="text-gray-500">
              Build hash: <span className="text-gray-300">{version.full_hash || "-"}</span>
            </div>
            <div className="text-gray-500">
              Release notes: <span className="text-gray-300">{version.message || "-"}</span>
            </div>
            <div className="text-gray-500">
              Build date: <span className="text-gray-300">{version.date || "-"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
