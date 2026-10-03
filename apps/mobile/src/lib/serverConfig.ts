/**
 * 服务器连接配置：启动时从 URL query 读取（为 QR 配对预留），写入 localStorage 持久化。
 *
 * 参数约定：
 *   ?server=192.168.1.10          → http://192.168.1.10:3030（缺省端口 3030，与 packages/server 一致）
 *   ?server=192.168.1.10:8080     → http://192.168.1.10:8080
 *   ?server=http://192.168.1.10:3030 | ?server=ws://192.168.1.10:3030 → 归一为 http origin
 *   ?token=<ZCODE_SERVER_TOKEN>   → 服务器开启鉴权时的令牌（packages/server/src/http.ts
 *                                    的 hasValidLiteToken 接受 ?token= 查询参数）
 *
 * 不带参数时回退 localStorage，再回退同源（dev 下由 vite 代理 /ws 与 /api 到
 * localhost:3030；由 zcode --web 直接托管时即为服务器本身）。
 * 源码内不写死任何主机或令牌。
 */

export interface ServerConfig {
  /** http(s) origin，例如 "http://192.168.1.10:3030"。WS 地址由它派生（http→ws）。 */
  readonly origin: string;
  /** 服务器鉴权令牌；未配置鉴权时为 null。 */
  readonly token: string | null;
  /** 是否来自 URL 参数（意味着刚完成配对，值得提示）。 */
  readonly fromUrlParams: boolean;
}

const STORAGE_KEY_SERVER = "zcode:mobile:server";
const STORAGE_KEY_TOKEN = "zcode:mobile:token";

/** zcode --web 的默认端口（packages/server/src/entry-http.ts: PORT || 3030）。 */
const DEFAULT_SERVER_PORT = 3030;

export function readStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式 / storage 不可用时静默降级为内存态
  }
}

function removeStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 同上
  }
}

/**
 * 把用户/二维码提供的地址归一为 http(s) origin。
 * 只接受 http/https（ws/wss 视为等价的传输形式参与归一），其余一律拒绝。
 */
export function normalizeServerOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^wss:\/\//i.test(candidate)) {
    candidate = `https://${candidate.slice("wss://".length)}`;
  } else if (/^ws:\/\//i.test(candidate)) {
    candidate = `http://${candidate.slice("ws://".length)}`;
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  // 拒绝内嵌凭据形式（http://user:pass@host），令牌只走独立参数。
  if (url.username || url.password) {
    return null;
  }
  // 未显式带端口时补默认端口 3030；new URL 会把缺省端口抹成 ""。
  const origin = url.port
    ? `${url.protocol}//${url.hostname}:${url.port}`
    : `${url.protocol}//${url.hostname}:${DEFAULT_SERVER_PORT}`;
  return origin;
}

function readTokenFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  const token = raw.trim();
  return token.length > 0 ? token : null;
}

/**
 * 启动时解析连接配置：URL 参数优先（并持久化），其次 localStorage，
 * 最后同源模式（origin = location.origin，token = null）。
 */
export function resolveServerConfig(
  search: string = window.location.search,
  defaultOrigin: string = window.location.origin,
): ServerConfig {
  const params = new URLSearchParams(search);
  const rawServer = params.get("server");
  const rawToken = readTokenFromUrl(params.get("token"));

  const normalized = rawServer ? normalizeServerOrigin(rawServer) : null;
  if (normalized) {
    writeStorageItem(STORAGE_KEY_SERVER, normalized);
    if (rawToken) {
      writeStorageItem(STORAGE_KEY_TOKEN, rawToken);
    } else {
      removeStorageItem(STORAGE_KEY_TOKEN);
    }
    return { origin: normalized, token: rawToken, fromUrlParams: true };
  }

  const storedServer = readStorageItem(STORAGE_KEY_SERVER);
  const storedToken = readStorageItem(STORAGE_KEY_TOKEN);
  if (storedServer) {
    return { origin: storedServer, token: storedToken, fromUrlParams: false };
  }

  return { origin: defaultOrigin, token: null, fromUrlParams: false };
}

/** WebSocket RPC 端点（packages/server/src/http.ts 的 /ws 升级路由）。 */
export function serverWsUrl(config: ServerConfig): string {
  const wsBase = config.origin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  const url = new URL(`${wsBase}/ws`);
  if (config.token) {
    url.searchParams.set("token", config.token);
  }
  return url.toString();
}

/** HTTP API 端点（/api/server-info 等；仅 http/https）。 */
export function serverHttpUrl(config: ServerConfig, path: string): string {
  const base = new URL(config.origin);
  base.pathname = path;
  if (config.token) {
    base.searchParams.set("token", config.token);
  }
  return base.toString();
}
