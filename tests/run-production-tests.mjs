import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mediumFeedFixture } from "./medium-feed-fixture.mjs";

const hostileMediumFeedFixture = mediumFeedFixture.replace(
  "MEDIUM POST 03",
  "</script><script>globalThis.__mediumXssExecuted=1</script>",
);

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const nextCli = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function findAvailablePort() {
  const server = createServer();
  const address = await listen(server);
  await close(server);
  return address.port;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }`,
        ),
      );
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready (${child.exitCode})`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server may still be opening its listening socket.
    }

    await delay(100);
  }

  throw new Error("Timed out waiting for the Next.js production server");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;

  const exited = once(child, "exit");
  child.kill("SIGTERM");

  await Promise.race([
    exited,
    delay(5_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

const feedServer = createServer((request, response) => {
  if (request.url === "/feed") {
    response.writeHead(200, { "content-type": "application/rss+xml" });
    response.end(hostileMediumFeedFixture);
    return;
  }

  response.writeHead(404);
  response.end("Not found");
});

let nextProcess;

try {
  const feedAddress = await listen(feedServer);
  const feedUrl = `http://127.0.0.1:${feedAddress.port}/feed`;
  const appPort = await findAvailablePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const testEnvironment = {
    ...process.env,
    MEDIUM_FEED_ALLOW_LOCALHOST: "1",
    MEDIUM_FEED_URL: feedUrl,
    PATREON_ACCESS_PASSWORD: "production-test-member-password",
    PATREON_SESSION_SECRET:
      "production-test-session-secret-at-least-32-characters",
  };

  await run("npm", ["run", "build"], testEnvironment);

  nextProcess = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: projectRoot,
      env: testEnvironment,
      stdio: "inherit",
    },
  );

  await waitForServer(appUrl, nextProcess);
  await run(
    process.execPath,
    [
      "--test",
      "tests/rendered-html.test.mjs",
      "tests/party-protocol.test.mjs",
      "tests/medium-feed.test.mjs",
      "tests/github-feed.test.mjs",
    ],
    {
      ...testEnvironment,
      TEST_BASE_URL: appUrl,
    },
  );
} finally {
  await stopProcess(nextProcess);
  if (feedServer.listening) await close(feedServer);
}
