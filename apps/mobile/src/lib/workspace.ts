import { useEffect, useState } from "react";
import type { IServiceAccessor } from "@zcode/services";
import { serverHttpUrl, type ServerConfig } from "./serverConfig.js";

export interface WorkspaceTarget {
  workspacePath: string;
  /** 展示名（桌面侧栏同款：目录 basename）。 */
  label?: string;
}

const STORAGE_KEY_WORKSPACE = "zcode:mobile:workspace";

/** 用户切换过的 workspace；未切换时为 null（跟随服务器默认/列表第一项）。 */
export function readStoredWorkspacePath(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_WORKSPACE);
  } catch {
    return null;
  }
}

/** 记住选择（重载/重启后回到该项目）。 */
export function rememberWorkspacePath(path: string): void {
  const trimmed = path.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(STORAGE_KEY_WORKSPACE, trimmed);
  } catch {
    // storage 不可用时静默降级
  }
}

/**
 * 会话/命令 RPC 全部要求 workspace 定位（ZCodeAgentWorkspaceTarget.workspacePath）。
 * 服务器在 server-info 里返回与桌面侧栏一致的项目列表（recentProjects 投影）；
 * 用户的选择优先，否则用列表第一项。不写死任何路径。
 */
export function useWorkspace(
  config: ServerConfig,
  accessor: IServiceAccessor | null,
  selectedPath: string | null,
): {
  workspaceList: WorkspaceTarget[];
  workspace: WorkspaceTarget | null;
  error: string | null;
} {
  const [workspaceList, setWorkspaceList] = useState<WorkspaceTarget[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessor) {
      setWorkspaceList([]);
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
          workspaces?: Array<{ path?: string; label?: string }>;
        };
        const list = (info.workspaces ?? [])
          .filter((entry): entry is { path: string; label?: string } => Boolean(entry.path))
          .map((entry) => ({ workspacePath: entry.path, label: entry.label }));
        if (!cancelled) {
          setWorkspaceList(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setWorkspaceList([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, accessor]);

  const workspace =
    workspaceList.find((entry) => entry.workspacePath === selectedPath) ??
    workspaceList[0] ??
    null;

  return { workspaceList, workspace, error };
}
