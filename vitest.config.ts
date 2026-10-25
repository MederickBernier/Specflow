import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["fixtures/build.ts"],
    projects: [
      "packages/*",
      {
        test: {
          name: "fixtures",
          include: ["fixtures/*.test.ts"],
        },
      },
    ],
    passWithNoTests: true,
  },
});
