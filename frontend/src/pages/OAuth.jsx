import { Check, ChevronDown, Copy, ExternalLink, Loader2, Rocket } from "lucide-react";
import { useState } from "react";
import Modal from "../components/Modal";
import api from "../api";

export default function OAuth() {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [showCallbackInput, setShowCallbackInput] = useState(false);
  const [credsContent, setCredsContent] = useState("");
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  const startAuth = async () => {
    setLoading(true);
    setMessage(null);
    setAuthUrl("");
    setCredsContent("");

    try {
      const res = await api.post("/auth/start", {});
      setAuthUrl(res.data.auth_url);
      setMessage({ type: "info", text: "Auth link generated. Complete the Google authorization in the new window" });
    } catch (err) {
      setMessage({
        type: "error",
        text: err.response?.data?.detail || "Failed to get the auth link",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchCredentials = async () => {
    setFetching(true);
    try {
      const res = await api.post("/auth/callback", {});
      setCredsContent(JSON.stringify(res.data.credentials, null, 2));
      setMessage({
        type: "success",
        text: `Authenticated! Credential saved: ${res.data.email || "unknown email"}`,
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err.response?.data?.detail || "Failed to get the credential. Make sure you completed the authorization",
      });
    } finally {
      setFetching(false);
    }
  };

  const processCallbackUrl = async () => {
    if (!callbackUrl.trim()) {
      setMessage({ type: "error", text: "Paste the full callback URL" });
      return;
    }
    setFetching(true);
    try {
      const res = await api.post("/auth/callback-url", {
        callback_url: callbackUrl.trim(),
      });
      setCredsContent(JSON.stringify(res.data.credentials, null, 2));
      setMessage({
        type: "success",
        text: `Authenticated! Credential saved: ${res.data.email || "unknown email"}`,
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err.response?.data?.detail || "Failed to get the credential from the callback URL",
      });
    } finally {
      setFetching(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(authUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadCreds = () => {
    const blob = new Blob([credsContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "antigravity-credentials.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Info card */}
      <div className="bg-gradient-to-br from-orange-900/30 to-orange-800/10 border border-orange-700/30 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Rocket className="w-5 h-5 text-orange-400" />
          <h3 className="text-lg font-semibold text-orange-400">Antigravity authentication</h3>
        </div>
        <p className="text-sm text-gray-400">
          Get an Antigravity credential through Google OAuth. After authorization the system automatically fetches the Project ID
          and subscription tier, and saves the credential to the database.
        </p>
      </div>

      {/* Message dialog */}
      {message && (
        <Modal
          type={message.type}
          title={message.type === "success" ? "Success" : message.type === "error" ? "Error" : "Notice"}
          onClose={() => setMessage(null)}
        >
          <span className="whitespace-pre-wrap break-all">{message.text}</span>
        </Modal>
      )}

      {/* Get auth link button */}
      <button
        onClick={startAuth}
        disabled={loading}
        className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="animate-spin" size={18} />
        ) : (
          <Rocket size={18} />
        )}
        Get Antigravity auth link
      </button>

      {/* Auth link */}
      {authUrl && (
        <div className="card space-y-4">
          <h3 className="font-semibold">Auth link</h3>
          <div className="bg-dark-800 border border-purple-500/30 rounded-lg p-4 flex items-center justify-between gap-3">
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 break-all text-sm flex items-center gap-1"
            >
              Click this link to sign in with Google <ExternalLink size={14} />
            </a>
            <button
              onClick={copyUrl}
              className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 flex-shrink-0"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-sm text-gray-400">
            <p className="font-medium text-blue-400 mb-2">How to use</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Click the auth link above and authorize your Google account in the new window</li>
              <li>After authorizing, you are redirected to a localhost success page</li>
              <li>Close the OAuth window and return to this page</li>
              <li>Click the "Get credential" button below to finish</li>
            </ol>
          </div>

          {/* Callback URL shortcut */}
          <div className="border border-dark-600 rounded-lg">
            <button
              onClick={() => setShowCallbackInput(!showCallbackInput)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-gray-200"
            >
              <span>🚀 Callback not reaching the server? Use the shortcut (paste the callback URL)</span>
              <ChevronDown
                size={16}
                className={`transition-transform ${showCallbackInput ? "rotate-180" : ""}`}
              />
            </button>
            {showCallbackInput && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-gray-500">
                  Use this on a cloud server/VPS, in a Docker container, or when a firewall blocks the callback port.
                  After authorizing with Google, copy the full URL from the browser address bar and paste it below.
                </p>
                <textarea
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="http://localhost:11451/?state=xxx&code=xxx&scope=xxx..."
                  className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-white placeholder-gray-500"
                  rows={3}
                />
                <button
                  onClick={processCallbackUrl}
                  disabled={fetching}
                  className="btn btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {fetching && <Loader2 className="animate-spin" size={14} />}
                  Get credential from callback URL
                </button>
              </div>
            )}
          </div>

          {/* Get credential button */}
          <button
            onClick={fetchCredentials}
            disabled={fetching}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {fetching && <Loader2 className="animate-spin" size={18} />}
            Get Antigravity credential
          </button>
        </div>
      )}

      {/* Credential content */}
      {credsContent && (
        <div className="card space-y-4">
          <h3 className="font-semibold">Credential content</h3>
          <pre className="bg-dark-800 border border-dark-600 rounded-lg p-4 text-xs text-gray-300 overflow-x-auto max-h-96 overflow-y-auto">
            {credsContent}
          </pre>
          <button onClick={downloadCreds} className="btn btn-secondary text-sm">
            Download credential file
          </button>
        </div>
      )}
    </div>
  );
}
