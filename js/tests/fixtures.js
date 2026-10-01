import { spawn } from "node:child_process";
import { test as base, expect } from "@playwright/test";

export { expect };
export const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixtures.
  studioURL: async ({}, use) => {
    const server = spawn(
      "python",
      ["-m", "spaday_studio.server", "--port", "0"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let output = "";
    const closed = new Promise((resolve) => server.once("close", resolve));
    try {
      const url = await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.once("exit", (code) =>
          reject(new Error(`Studio exited (${code}): ${output}`)),
        );
        server.stderr.on("data", (chunk) => {
          output += chunk.toString();
          const match = output.match(/Uvicorn running on (http:\/\/\S+)/);
          if (match) resolve(match[1]);
        });
      });
      await use(url);
    } finally {
      server.kill("SIGTERM");
      await closed;
    }
  },
});
