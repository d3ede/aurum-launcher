// Real Modrinth dependency and content lifecycle check against the running release.
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9227");
const page = browser.contexts()[0].pages()[0];
const rpc = (action, payload = {}) =>
  page.evaluate(
    async ({ action, payload }) =>
      window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }),
    { action, payload },
  );
const snapshot = await rpc("snapshot");
assert(snapshot.dataDir.includes(".test-data"));
const created = [];
try {
  const results = await rpc("search", {
    query: {
      query: "Iris",
      source: "modrinth",
      kind: "mod",
      minecraft: "1.21.1",
      loader: "fabric",
      offset: 0,
    },
  });
  const project = results.projects.find((p) => p.title === "Iris Shaders");
  assert(project, "Iris Shaders must be returned by the real API");
  const detail = await rpc("project", {
    source: "modrinth",
    id: project.id,
    minecraft: "1.21.1",
    loader: "fabric",
  });
  assert(detail.versions.length > 1);
  const versions = await rpc("loaders", {
    minecraft: "1.21.1",
    loader: "fabric",
  });
  const profile = await rpc("createProfile", {
    name: "Content smoke",
    minecraft: "1.21.1",
    loader: "fabric",
    loaderVersion: versions[0],
    cover: 0,
  });
  created.push(profile.id);
  await rpc("installContent", {
    id: profile.id,
    source: "modrinth",
    projectId: project.id,
    versionId: detail.versions[1].id,
    operationId: crypto.randomUUID(),
  });
  let content = await rpc("content", { id: profile.id });
  assert(
    content.some((c) => c.name === "Sodium"),
    "Required Sodium dependency must be installed automatically",
  );
  assert(content.some((c) => c.projectId === project.id));
  for (const item of content) {
    assert(
      statSync(
        join(snapshot.dataDir, "instances", profile.id, "mods", item.filename),
      ).size > 1000,
    );
  }
  const iris = content.find((c) => c.projectId === project.id);
  await rpc("updateContent", {
    id: profile.id,
    contentId: iris.id,
    operationId: crypto.randomUUID(),
  });
  content = await rpc("content", { id: profile.id });
  assert.equal(
    content.find((c) => c.id === iris.id).versionId,
    detail.versions[0].id,
  );
  await rpc("manageContent", {
    id: profile.id,
    contentId: iris.id,
    action: "toggle",
  });
  assert.equal(
    (await rpc("content", { id: profile.id })).find((c) => c.id === iris.id)
      .enabled,
    false,
  );
  await rpc("manageContent", {
    id: profile.id,
    contentId: iris.id,
    action: "toggle",
  });
  assert.equal(
    (await rpc("content", { id: profile.id })).find((c) => c.id === iris.id)
      .enabled,
    true,
  );
  await rpc("manageContent", {
    id: profile.id,
    contentId: iris.id,
    action: "remove",
  });
  assert(
    !(await rpc("content", { id: profile.id })).some((c) => c.id === iris.id),
  );
  const vanilla = await rpc("createProfile", {
    name: "Compatibility smoke",
    minecraft: "1.21.1",
    loader: "vanilla",
    cover: 0,
  });
  created.push(vanilla.id);
  await assert.rejects(
    rpc("installContent", {
      id: vanilla.id,
      source: "modrinth",
      projectId: project.id,
      versionId: detail.versions[0].id,
      operationId: crypto.randomUUID(),
    }),
    (error) => String(error).includes("несовместима"),
  );
  assert.deepEqual(await rpc("content", { id: vanilla.id }), []);
  writeFileSync(
    ".test-data/native-content-result.json",
    JSON.stringify(
      {
        passed: true,
        project: project.title,
        versions: detail.versions.slice(0, 2),
        requiredDependency: "Sodium",
        checks: [
          "verified real downloads",
          "required dependency",
          "update to latest",
          "disable and enable",
          "remove",
          "reject incompatible Vanilla",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: real Iris/Sodium dependencies, update, toggle, remove and compatibility rejection",
  );
} finally {
  for (const id of created) await rpc("deleteProfile", { id });
  await browser.close();
}
