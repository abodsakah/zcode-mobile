import { useCallback, useEffect, useRef, useState } from "react";
import type { IServiceAccessor } from "@zcode/services";
import type { ZCodeSessionInfo } from "@zcode/shared";
import type { WorkspaceTarget } from "./workspace.js";

/** 活跃会话 id 持久化键（重开 App 后回到上次会话）。 */
const ACTIVE_SESSION_STORAGE_KEY = "zcode:mobile:active-session";

export function readPersistedActiveSession(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistActiveSession(sessionId: string | null): void {
  try {
    if (sessionId) {
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
    } else {
      localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  } catch {
    // storage 不可用时跳过持久化
  }
}

export interface SessionsState {
  sessions: ZCodeSessionInfo[] | null;
  error: string | null;
  loading: boolean;
}

/**
 * 会话列表：IZCodeSessionService.listSessions（terminal RPC → session/list）。
 * 按 updatedAt 倒序排（schema 不承诺顺序，sessions-index 的排序也是客户端展示逻辑）。
 */
export function useSessions(
  accessor: IServiceAccessor | null,
  workspace: WorkspaceTarget | null,
  connectionEpoch: number,
): SessionsState & { refresh: () => void } {
  const [state, setState] = useState<SessionsState>({ sessions: null, error: null, loading: false });
  const [refreshTick, setRefreshTick] = useState(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!accessor || !workspace) {
      setState({ sessions: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    loadingRef.current = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    accessor.zcodeSessionService
      .listSessions({ workspacePath: workspace.workspacePath, limit: 50 })
      .then((sessions) => {
        if (cancelled) return;
        const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
        setState({ sessions: sorted, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          sessions: null,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        });
      })
      .finally(() => {
        loadingRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [accessor, workspace, connectionEpoch, refreshTick]);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  return { ...state, refresh };
}

/**
 * 活跃会话选择：持久化 id 命中列表则用它，否则打开最新一条；
 * 列表为空则保持 draft（首条消息发送时经 createSession+firstInput 建会话）。
 */
export function useActiveSession(
  sessions: ZCodeSessionInfo[] | null,
): [string | null, (sessionId: string | null) => void] {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    readPersistedActiveSession,
  );
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    persistActiveSession(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!sessions || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setActiveSessionId((current) => {
      if (current && sessions.some((session) => session.sessionId === current)) {
        return current;
      }
      return sessions[0]?.sessionId ?? null;
    });
  }, [sessions]);

  const setActive = useCallback((sessionId: string | null) => {
    autoOpenedRef.current = true;
    setActiveSessionId(sessionId);
  }, []);

  return [activeSessionId, setActive];
}
