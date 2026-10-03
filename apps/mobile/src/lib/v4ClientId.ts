import { uuidv7 } from "@zcode/shared";

/**
 * v4 客户端稳定身份。与 packages/ui/src/v4/commandFactory.ts 使用同一个
 * localStorage 键与 `client-` 前缀约定：服务端幂等表按 clientId 区分提交端，
 * 刷新/重开后保持不变。
 */
const CLIENT_ID_STORAGE_KEY = "zcode-v4-client-id:v1";

let cachedClientId: string | null = null;

export function getV4ClientId(): string {
  if (cachedClientId) return cachedClientId;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    // 无 storage 环境退化为进程内稳定
  }
  const clientId = stored ?? `client-${uuidv7()}`;
  if (!stored) {
    try {
      localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    } catch {
      // 同上
    }
  }
  cachedClientId = clientId;
  return clientId;
}

export function newCommandId(): string {
  return uuidv7();
}
