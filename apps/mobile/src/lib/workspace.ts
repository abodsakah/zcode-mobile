import { useEffect, useState } from "react";
import type { IServiceAccessor } from "@zcode/services";
import { serverHttpUrl, type ServerConfig } from "./serverConfig.js";

export interface WorkspaceTarget {
  workspacePath: string;
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
