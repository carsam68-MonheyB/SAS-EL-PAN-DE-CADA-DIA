import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["pruebas/**/*.test.ts"],
    globalSetup: ["pruebas/configuracion-global.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
