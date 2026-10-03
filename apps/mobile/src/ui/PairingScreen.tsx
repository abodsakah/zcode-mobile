import { useState, type FormEvent } from "react";
import {
  parsePairingInput,
  writeStorageItem,
  type ParsedPairingInput,
} from "../lib/serverConfig.js";

const STORAGE_KEY_SERVER = "zcode:mobile:server";
const STORAGE_KEY_TOKEN = "zcode:mobile:token";

/**
 * 首屏配对页：打包后的 APK 没有同源服务器可回退，也没有 URL 参数可解析，
 * 必须由用户粘贴 /pair-mobile 输出的配对 URL 才能建立连接。
 */
export function PairingScreen() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPairingInput | null>(null);

  const reparse = (value: string) => {
    setInput(value);
    setError(null);
    setParsed(value.trim() ? parsePairingInput(value) : null);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        reparse(text);
      } else {
        setError("Clipboard is empty — copy the pairing URL from the desktop app first.");
      }
    } catch {
      setError("Clipboard unavailable — paste the URL manually in the field above.");
    }
  };

  const handleConnect = (event: FormEvent) => {
    event.preventDefault();
    const result = parsePairingInput(input);
    if (!result) {
      setError("That doesn't look like a server address or pairing URL.");
      return;
    }
    writeStorageItem(STORAGE_KEY_SERVER, result.origin);
    if (result.token) {
      writeStorageItem(STORAGE_KEY_TOKEN, result.token);
    }
    // 重载后 resolveServerConfig 从 localStorage 命中配置并直接连接。
    window.location.reload();
  };

  return (
    <div className="flex h-dvh min-h-dvh flex-col items-center justify-center bg-background px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-foreground">
      <div className="w-full max-w-sm space-y-5">
        <div className="space-y-2 text-center">
          <h1 className="text-ui-lg font-semibold">Connect to your Mac</h1>
          <p className="text-ui-base/relaxed text-foreground-subtle">
            Run <span className="font-medium text-foreground">/pair-mobile</span> in the ZCode desktop
            app, then paste the pairing URL it prints below the QR code.
          </p>
        </div>
        <form className="space-y-3" onSubmit={handleConnect}>
          <textarea
            className="min-h-20 w-full resize-none rounded-xl border border-card-border bg-card px-3 py-2.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-focused"
            placeholder="http://100.x.y.z:3141/?server=…&amp;token=…"
            value={input}
            onChange={(event) => reparse(event.target.value)}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {parsed ? (
            <p className="break-all text-ui-xs text-foreground-subtlest">
              Will connect to <span className="text-foreground-subtle">{parsed.origin}</span>
              {parsed.token ? " (with token)" : " (no token)"}
            </p>
          ) : null}
          {error ? <p className="text-ui-xs text-[var(--color-danger,#f87171)]">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="h-12 shrink-0 rounded-xl border border-card-border bg-card px-4 text-ui-base font-medium text-foreground-subtle active:bg-surface-hover"
            >
              Paste
            </button>
            <button
              type="submit"
              disabled={!parsed}
              className="h-12 min-w-0 flex-1 rounded-xl bg-primary px-4 text-ui-base font-semibold text-primary-foreground disabled:opacity-40"
            >
              Connect
            </button>
          </div>
        </form>
        <p className="text-center text-ui-xs text-foreground-subtlest">
          The phone must be on the same Tailscale network as the Mac.
        </p>
      </div>
    </div>
  );
}
