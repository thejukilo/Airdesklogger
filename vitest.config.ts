import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    // The integration tests share one database, so run files one at a time to
    // keep results deterministic. The suite is small enough that this is fast.
    fileParallelism: false,
  },
});
