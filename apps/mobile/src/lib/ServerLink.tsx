import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { connectViaWebSocket } from "@zcode/client";
import type { IServiceAccessor } from "@zcode/services";
import {
  resolveServerConfig,
  serverWsUrl,
  type ServerConfig,
} from "./serverConfig.js";

export type ServerLinkState =
  | { kind: "connecting" }
  | { kind: "online"; accessor: IServiceAccessor }
  | { kind: "offline"; message: string };

interface ServerLinkContextValue {
  config: ServerConfig;
  state: ServerLinkState;
}

const ServerLinkContext = createContext<ServerLinkContextValue | null>(null);

/** 重连退避：1s 起步、指数增长、封顶 15s。 */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;

interface ServerLinkProviderProps {
  children: ReactNode;
}

/**
 * 服务器连接层：resolveServerConfig（URL 参数 → localStorage → 同源）解析配置，
 * 用 @zcode/client 的 connectViaWebSocket 建立 RPC 通道（/ws），断线后自动退避重连。
 */
export function ServerLinkProvider({ children }: ServerLinkProviderProps) {
  const config = useMemo(() => resolveServerConfig(), []);
  const [state, setState] = useState<ServerLinkState>({ kind: "connecting" });
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    const clearRetry = () => {
      if (retryTimer.current !== null) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };

    const scheduleRetry = (message: string) => {
      if (cancelled) return;
      setState({ kind: "offline", message });
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
      attempt += 1;
      retryTimer.current = setTimeout(connect, delay);
    };

    const connect = () => {
      if (cancelled) return;
      clearRetry();
      setState({ kind: "connecting" });
      connectViaWebSocket(serverWsUrl(config), {
        onClose: () => {
          if (cancelled) return;
          scheduleRetry("connection closed");
        },
      })
        .then((accessor) => {
          if (cancelled) return;
          attempt = 0;
          setState({ kind: "online", accessor });
        })
        .catch((error: unknown) => {
          scheduleRetry(error instanceof Error ? error.message : String(error));
        });
    };

    connect();
    return () => {
      cancelled = true;
      clearRetry();
    };
  }, [config]);

  const value = useMemo(() => ({ config, state }), [config, state]);
  return <ServerLinkContext.Provider value={value}>{children}</ServerLinkContext.Provider>;
}

export function useServerLink(): ServerLinkContextValue {
  const value = useContext(ServerLinkContext);
  if (!value) {
    throw new Error("useServerLink must be used within ServerLinkProvider");
  }
  return value;
}
