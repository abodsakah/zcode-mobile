import { useEffect, useState } from "react";
import type { IServiceAccessor } from "@zcode/services";
import { serverHttpUrl, type ServerConfig } from "./serverConfig.js";

export interface WorkspaceTarget {
  workspacePath: string;
}

const STORAGE_KEY_WORKSPACE = "zcode:mobile:workspace";
const STORAGE_KEY_RECENT_WORKSPACES = "zcode:mobile:recent-workspaces";
const MAX_RECENT_WORKSPACES = 5;

/** 用户切换过的 workspace；未切换时为 null（跟随服务器默认）。 */
export function readStoredWorkspacePath(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_WORKSPACE);
  } catch {
    return null;
  }
}

/** 记住选择并维护最近列表（去重、最新在前、最多 5 条）。 */
export function rememberWorkspacePath(path: string): void {
  const trimmed = path.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(STORAGE_KEY_WORKSPACE, trimmed);
    const recent: string[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY_RECENT_WORKSPACES) ?? "[]",
    );
    const next = [trimmed, ...recent.filter((item) => item !== trimmed)].slice(
      0,
      MAX_RECENT_WORKSPACES,
    );
    localStorage.setItem(STORAGE_KEY_RECENT_WORKSPACES, JSON.stringify(next));
  } catch {
    // storage 不可用时静默降级
  }
}

export function readRecentWorkspaces(): string[] {
  try {
    const recent: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY_RECENT_WORKSPACES) ?? "[]",
    );
    return Array.isArray(recent) ? recent.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 会话/命令 RPC 全部要求 workspace 定位（ZCodeAgentWorkspaceTarget.workspacePath）。
 * mobile 通过 /api/server-info 拿服务器默认 workspace（与 packages/web/src/main.tsx
 * 的 resolveWebBootstrap 同一来源），不写死任何路径。
 */
export function useWorkspace(
  config: ServerConfig,
  accessor: IServiceAccessor | null,
): { workspace: WorkspaceTarget | null; error: string | null } {
  const [workspace, setWorkspace] = useState<WorkspaceTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessor) {
      setWorkspace(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(serverHttpUrl(config, "/api/server-info"), {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`server-info ${response.status}`);
        }
        const info = (await response.json()) as {
          workspaces?: Array<{ path?: string }>;
        };
        const path = info.workspaces?.[0]?.path;
        if (!path) {
          throw new Error("server reported no workspace");
        }
        if (!cancelled) {
          setWorkspace({ workspacePath: path });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setWorkspace(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, accessor]);

  return { workspace, error };
}
