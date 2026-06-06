import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    plugins: [
      react(),
    {
      name: "local-ai-api",
      configureServer(server) {
        server.middlewares.use("/api/ai-generate-shapes", async (request, response) => {
          const { default: handler } = await import("./api/ai-generate-shapes.js");
          const vercelResponse = Object.assign(response, {
            status(code: number) {
              response.statusCode = code;
              return vercelResponse;
            },
            send(payload: string) {
              response.end(payload);
            },
          });
          await handler(request, vercelResponse);
        });
        server.middlewares.use("/api/ai-recognize-shapes", async (request, response) => {
          const { default: handler } = await import("./api/ai-recognize-shapes.js");
          const vercelResponse = Object.assign(response, {
            status(code: number) {
              response.statusCode = code;
              return vercelResponse;
            },
            send(payload: string) {
              response.end(payload);
            },
          });
          await handler(request, vercelResponse);
        });
        server.middlewares.use("/api/overpass", async (request, response) => {
          const { default: handler } = await import("./api/overpass.js");
          const vercelResponse = Object.assign(response, {
            status(code: number) {
              response.statusCode = code;
              return vercelResponse;
            },
            send(payload: string) {
              response.end(payload);
            },
          });
          await handler(request, vercelResponse);
        });
      },
    },
  ],
    server: {
      allowedHosts: ["host.docker.internal"],
    },
  };
});
