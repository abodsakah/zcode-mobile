import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // packages/ui 的源码直接交给 Vite 打包，其内部 "@/..." 导入必须在消费方
        // Vite 配置里解析（与 packages/web/vite.config.ts 的处理一致）。
        "@": resolve(HERE, "../../packages/ui/src"),
      },
    },
    optimizeDeps: {
      // 与 packages/web 一致：显式加入 react 相关入口，避免 rolldown 在依赖
      // 预构建阶段解析 `react/jsx-runtime` 时返回无后缀路径导致加载失败。
      include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    server: {
      // 5173 被 packages/web 占用；mobile dev 端口错开。
      // host: true 让真机/模拟器通过局域网 IP 访问 dev server（Capacitor 调试用）。
      host: true,
      port: 5273,
      proxy: {
        // 移动端先复用本地 server（默认 3030），与 packages/web 的代理约定一致。
        "/ws": { target: "ws://localhost:3030", ws: true },
        "/api": { target: "http://localhost:3030" },
      },
    },
    build: {
      // 生产不在产物暴露 sourceMappingURL，与 packages/web 的约定一致。
      sourcemap: true,
    },
  };
});
