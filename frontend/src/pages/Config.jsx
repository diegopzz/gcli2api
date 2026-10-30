import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import Modal from "../components/Modal";
import Select from "../components/Select";
import api from "../api";

const CONFIG_GROUPS = [
  {
    title: "Server",
    fields: [
      { key: "host", label: "Server host", type: "text", note: "Address the server listens on; 0.0.0.0 listens on all interfaces (takes effect after restart)" },
      { key: "port", label: "Server port", type: "number", note: "Port the server listens on (takes effect after restart)" },
      { key: "api_password", label: "API password", type: "text", note: "Password for the chat API, used to authenticate the OpenAI / Gemini / Claude endpoints" },
      { key: "panel_password", label: "Control panel password", type: "text", note: "Password to access this control panel" },
    ],
  },
  {
    title: "IP allowlist",
    fields: [
      { key: "ip_whitelist_enabled", label: "Enable IP allowlist", type: "bool", note: "When on, only allowlisted IPs can reach the panel and API; all others get 403. An empty list or turning this off means no restriction. Takes effect immediately on save (hot reload)" },
      { key: "ip_whitelist", label: "Allowed IPs", type: "textarea", showIf: (cfg) => !!cfg.ip_whitelist_enabled, note: "One entry per line: a single IP, a CIDR range, or a start-end range (separated by - or ~). IPv4 and IPv6 both work", placeholder: "For example:\n127.0.0.1\n192.168.1.0/24\n10.0.0.1-10.0.0.100\n::1\n2001:db8::/32" },
    ],
  },
  {
    title: "General",
    fields: [
      { key: "credentials_dir", label: "Credentials directory", type: "text", note: "Directory where credential files are stored" },
      { key: "proxy", label: "Proxy", type: "text", note: "Supports http/https/socks5/socks5h, optionally with credentials (user:pass@host:port). Leave empty for no proxy (takes effect after restart)", placeholder: "http://user:pass@proxy:port or socks5h://proxy:port" },
    ],
  },
  {
    title: "Endpoints",
    fields: [
      { key: "oauth_proxy_url", label: "OAuth Endpoint", type: "text", note: "Google OAuth2 endpoint, used to obtain and refresh tokens" },
      { key: "googleapis_proxy_url", label: "Google APIs Endpoint", type: "text", note: "Google APIs endpoint" },
      { key: "antigravity_api_url", label: "Antigravity API Endpoint", type: "text", note: "Antigravity API endpoint" },
    ],
  },
  {
    title: "Auto-ban",
    fields: [
      { key: "auto_ban_enabled", label: "Enable auto-ban", type: "bool", note: "Automatically disable a credential when it hits one of the listed error codes" },
      { key: "auto_ban_error_codes", label: "Auto-ban error codes", type: "text", note: "JSON array, e.g. [403, 400]" },
    ],
  },
  {
    title: "Retries",
    fields: [
      { key: "retry_429_enabled", label: "Enable retries", type: "bool", note: "Automatically retry when a request fails" },
      { key: "retry_429_max_retries", label: "Max retries", type: "number", note: "Maximum number of retries after an error" },
      { key: "retry_429_interval", label: "Retry interval (seconds)", type: "number", note: "Seconds to wait between retries; 0 retries immediately. Range 0-3600" },
    ],
  },
  {
    title: "Credential selection",
    fields: [
      {
        key: "credential_select_mode",
        label: "Selection mode",
        type: "select",
        note: "How a credential is picked for each API request",
        options: [
          { value: "random", label: "Fully random" },
          { value: "cache", label: "Cache affinity (recommended)" },
          { value: "sticky", label: "Sticky until cooldown" },
        ],
        descriptions: {
          random: "Fully random load balancing: each request picks a random available credential. Spreads load most evenly, but the same conversation may hit different credentials, so the upstream prompt cache can't be used.",
          cache: "Cache affinity (recommended default): hashes \"model + system instruction (or first user message)\" into a session key, so the same conversation always reuses the same credential. This hits Google's upstream prompt cache, making long conversations faster and cheaper in tokens. When a credential enters cooldown, the session switches and rebinds automatically. Pair with Redis (REDIS_URL) to share this across instances.",
          sticky: "Sticky credential: all requests use the same credential until it enters cooldown or is disabled, then move to the next one. Maximizes cache hits on one credential, but load is uneven: one credential takes all traffic while the rest sit idle.",
        },
      },
    ],
  },
  {
    title: "Responses",
    fields: [
      { key: "return_thoughts_to_frontend", label: "Return reasoning to the client", type: "bool", note: "When on, the model's reasoning (thoughts) is included in responses; when off it is filtered out" },
    ],
  },
  {
    title: "Anti-truncation",
    fields: [
      { key: "anti_truncation_max_attempts", label: "Anti-truncation max attempts", type: "number", note: "Maximum continuation attempts when truncated output is detected (1-10). Applies to models prefixed with '抗截断-'" },
    ],
  },
  {
    title: "Sensitive word filter",
    fields: [
      { key: "sensitive_words_enabled", label: "Enable sensitive word filter", type: "bool", note: "Matching words in requests are removed, to avoid triggering the Google API's sensitive-content blocking" },
      { key: "sensitive_words", label: "Sensitive words", type: "textarea", showIf: (cfg) => !!cfg.sensitive_words_enabled, note: "One word or phrase per line, case-insensitive, any language. Matches are removed entirely. Takes effect immediately on save (hot reload)", placeholder: "For example:\nsensitive word\nanother phrase" },
    ],
  },
  {
    title: "Model name rewriting",
    fields: [
      { key: "model_rewrite_enabled", label: "Enable model name rewriting", type: "bool", note: "When on, the model name in each request is matched against the rules (regex supported) and replaced by the rule's target model on a match. Useful for mapping a client's fixed model name to an upstream model that actually exists. Takes effect immediately on save (hot reload)" },
      {
        key: "model_rewrite_rules",
        label: "Rewrite rules",
        type: "rules",
        showIf: (cfg) => !!cfg.model_rewrite_enabled,
        note: "One rule per row: a match regex + replacement model name. Evaluated top to bottom; the first match wins. Replacements support regex backreferences (e.g. \\1)",
      },
    ],
  },
  {
    title: "Request logs",
    fields: [
      { key: "usage_log_enabled", label: "Enable request logs", type: "bool", note: "Records every API request (model, credential, token usage, duration, status) in the database; view them on the \"Request Logs\" page. Logs are not pruned automatically; clean them up or clear them on that page" },
      { key: "request_log_enabled", label: "Enable detailed request body logs", type: "bool", note: "When on, and a request ends with one of the error codes below, the full upstream request headers (redacted) and body are saved as a JSON file in data/request_logs/. Mainly for debugging request body errors; these files are deleted when logs are cleaned up or cleared" },
      { key: "request_log_error_codes", label: "Detailed log error codes", type: "csv_numbers", showIf: (cfg) => !!cfg.request_log_enabled, note: "Only write a detailed log when the final status code is in this list, comma-separated, e.g. 400, 429. Empty defaults to 400 only", placeholder: "400, 429" },
    ],
  },
];

export default function Config() {
  const [config, setConfig] = useState({});
  const [envLocked, setEnvLocked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async ({ silent = false } = {}) => {
    setLoading(true);
    try {
      const res = await api.get("/config/get");
      setConfig(res.data.config || {});
      setEnvLocked(res.data.env_locked || []);
      if (!silent) setMessage(null);
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to load settings" });
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await api.post("/config/save", { config });
      setMessage({ type: "success", text: res.data.message || "Settings saved" });
      // Silently reload settings (without clearing the dialog just shown)
      await loadConfig({ silent: true });
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const setField = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // One-click mirror/official endpoints (reverse-proxy option for networks that can't reach Google's official endpoints)
  const MIRROR_BASE = "https://gcli-api.sukaka.top";
  const OFFICIAL_ENDPOINTS = {
    oauth_proxy_url: "https://oauth2.googleapis.com",
    googleapis_proxy_url: "https://www.googleapis.com",
    antigravity_api_url: "https://daily-cloudcode-pa.googleapis.com",
  };
  const MIRROR_PATHS = {
    oauth_proxy_url: "/oauth2",
    googleapis_proxy_url: "/googleapis",
    antigravity_api_url: "/daily-cloudcode-pa",
  };

  const useMirrorUrls = () => {
    setConfig((prev) => {
      const next = { ...prev };
      for (const [key, path] of Object.entries(MIRROR_PATHS)) {
        if (!envLocked.includes(key)) next[key] = MIRROR_BASE + path;
      }
      return next;
    });
  };

  const restoreOfficialUrls = () => {
    setConfig((prev) => {
      const next = { ...prev };
      for (const [key, url] of Object.entries(OFFICIAL_ENDPOINTS)) {
        if (!envLocked.includes(key)) next[key] = url;
      }
      return next;
    });
  };

  const renderField = (field) => {
    const isLocked = envLocked.includes(field.key);
    const value = config[field.key] ?? "";

    if (isLocked) {
      return (
        <div className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          Locked by an environment variable. Change the variable and restart to apply
        </div>
      );
    }

    if (field.type === "bool") {
      return (
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => setField(field.key, !value)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              value ? "bg-purple-600" : "bg-dark-600"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                value ? "translate-x-5" : ""
              }`}
            />
          </button>
          <span className="text-sm text-gray-300">{value ? "Enabled" : "Disabled"}</span>
        </label>
      );
    }

    if (field.type === "select") {
      const current = field.options.find((o) => o.value === value) || field.options[0];
      return (
        <div className="space-y-2">
          <Select
            value={current?.value ?? ""}
            onChange={(v) => setField(field.key, v)}
            options={field.options}
            className="w-full sm:w-64"
          />
          {field.descriptions && current && (
            <div className="bg-dark-800/60 border border-dark-600 rounded-lg p-3 text-xs sm:text-sm text-gray-300 leading-relaxed">
              {field.descriptions[current.value]}
            </div>
          )}
        </div>
      );
    }

    if (field.type === "csv_numbers") {
      const text = Array.isArray(value) ? value.join(", ") : value || "";
      return (
        <input
          type="text"
          value={text}
          onChange={(e) => {
            const nums = e.target.value
              .split(/[,\s]+/)
              .map((x) => parseInt(x, 10))
              .filter((n) => Number.isInteger(n) && n >= 100 && n <= 599);
            setField(field.key, [...new Set(nums)]);
          }}
          placeholder={field.placeholder}
          className="w-full sm:w-64 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-white placeholder-gray-500 font-mono"
        />
      );
    }

    if (field.type === "rules") {
      const rules = Array.isArray(value)
        ? value.map((r) => (Array.isArray(r) ? [String(r[0] ?? ""), String(r[1] ?? "")] : ["", ""]))
        : [];
      const updateRule = (idx, col, val) => {
        const next = rules.map((r) => [...r]);
        next[idx][col] = val;
        setField(field.key, next);
      };
      const removeRule = (idx) => {
        setField(field.key, rules.filter((_, i) => i !== idx));
      };
      const addRule = () => {
        setField(field.key, [...rules, ["", ""]]);
      };
      return (
        <div className="space-y-2">
          {rules.length === 0 && (
            <div className="text-xs text-gray-500 bg-dark-800/60 border border-dark-700 rounded-lg px-3 py-2">
              No rules yet. Use the button below to add one
            </div>
          )}
          {rules.map((rule, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={rule[0]}
                onChange={(e) => updateRule(idx, 0, e.target.value)}
                placeholder="Match regex, e.g. ^gpt-4$"
                className="flex-1 min-w-0 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-white placeholder-gray-500 font-mono"
              />
              <span className="text-gray-500 text-sm shrink-0">→</span>
              <input
                type="text"
                value={rule[1]}
                onChange={(e) => updateRule(idx, 1, e.target.value)}
                placeholder="Replacement model, e.g. gemini-2.5-pro"
                className="flex-1 min-w-0 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-white placeholder-gray-500 font-mono"
              />
              <button
                type="button"
                onClick={() => removeRule(idx)}
                className="shrink-0 p-2 text-gray-500 hover:text-red-400 transition-colors"
                title="Delete this rule"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRule}
            className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <Plus size={14} />
            Add rule
          </button>
        </div>
      );
    }

    if (field.type === "textarea") {
      return (
        <textarea
          value={Array.isArray(value) ? value.join("\n") : value || ""}
          onChange={(e) => {
            const lines = e.target.value === "" ? [] : e.target.value.split("\n");
            setField(field.key, lines.map((w) => w.replace(/\s+$/, "")).filter((w) => w.trim() !== ""))
          }}
          placeholder={field.placeholder}
          rows={6}
          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-white placeholder-gray-500 font-mono"
        />
      );
    }

    return (
      <input
        type={field.type}
        value={value}
        onChange={(e) =>
          setField(
            field.key,
            field.type === "number" ? Number(e.target.value) : e.target.value
          )
        }
        placeholder={field.placeholder}
        className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-white placeholder-gray-500"
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Action buttons (sticky at the top of the viewport) */}
      <div className="sticky top-0 z-30 -mx-1 px-1 py-2 bg-dark-950/95 backdrop-blur border-b border-dark-700 rounded-lg">
        <div className="flex items-center gap-2">
        <button
          onClick={loadConfig}
          disabled={loading}
          className="btn btn-secondary text-sm flex items-center gap-1.5"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Reload settings
        </button>
        <button
          onClick={saveConfig}
          disabled={saving || loading}
          className="btn btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? "Saving..." : "Save settings"}
        </button>
        </div>
      </div>

      {/* Message dialog */}
      {message && (
        <Modal type={message.type} title={message.type === "success" ? "Success" : "Error"} onClose={() => setMessage(null)}>
          <span className="whitespace-pre-wrap break-all">{message.text}</span>
        </Modal>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-purple-500" size={28} />
        </div>
      ) : (
        <div className="space-y-6">
          {CONFIG_GROUPS.map((group) => (
            <div key={group.title} className="card">
              <h3 className="text-base font-semibold text-purple-400 mb-4 border-b border-dark-700 pb-3">
                {group.title}
              </h3>

              {group.title === "Endpoints" && (
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    type="button"
                    onClick={useMirrorUrls}
                    className="btn btn-secondary text-xs px-3 py-1.5"
                  >
                    🚀 Use mirror URLs
                  </button>
                  <button
                    type="button"
                    onClick={restoreOfficialUrls}
                    className="btn btn-secondary text-xs px-3 py-1.5"
                  >
                    🔄 Restore official endpoints
                  </button>
                </div>
              )}

              <div className="space-y-5">
                {group.fields
                  .filter((field) => !field.showIf || field.showIf(config))
                  .map((field) => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">
                        {field.label}
                      </label>
                      {renderField(field)}
                      {field.note && (
                        <p className="text-xs text-gray-500 mt-1.5">{field.note}</p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
