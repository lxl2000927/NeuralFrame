const { _electron: electron, expect } = require("@playwright/test");
const path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const { DEFINITIONS } = require("../src/core/component-definitions");
const root = path.resolve(__dirname, ".."),
  env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const output = process.env.NEURALFRAME_QA_OUT;
if (output) fs.mkdirSync(output, { recursive: true });
const available = {
  kind: "selectable",
  ready: true,
  assessment: "supported",
  reason: "QA installation adapter",
};
const pack = (id, component, version) => ({
  id,
  component,
  name: DEFINITIONS[component].name,
  version,
  size: 2048,
  downloaded: false,
  compatibility: available,
});
const components = [
  "mfg-renodx",
  "dlss-sr",
  "dlss-fg",
  "renodx-nr",
  "renodx-multipass",
  "feeder",
  "reshade",
  "streamline",
];
const snapshot = {
  root: "QA component panel",
  definitions: DEFINITIONS,
  warnings: [],
  runtimePacks: components.map((id) =>
    pack(id, id, id === "mfg-renodx" ? "1.5.5" : "QA 1"),
  ),
  packages: components.map((id) => ({
    id: id + "-old",
    component: id,
    version: "QA previous",
    source: "QA",
    present: true,
    compatibility: available,
  })),
  updates: {
    checkedAt: new Date().toISOString(),
    errors: [],
    candidates: [
      {
        id: "mfg-test",
        component: "mfg-renodx",
        tag: "1.9.0",
        name: "renodx-mfgunlock.addon64",
        repo: "mavismmg/MFGAdaUnlock-RenoDx",
        downloadable: true,
        sha256: "a".repeat(64),
        size: 2048,
        compatibility: {
          kind: "pending",
          ready: false,
          assessment: "unsupported",
        },
      },
    ],
  },
};
(async () => {
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [path.join(root, "test/fixtures/neuralframe-flow-main.cjs")],
    env,
  });
  try {
    const p = await app.firstWindow();
    p.setDefaultTimeout(15000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
    await p.setViewportSize({ width: 1600, height: 1000 });
    await p.evaluate(
      (value) => window.qa.setComponentStatusFixture(value),
      snapshot,
    );
    await p
      .getByRole("navigation")
      .getByRole("button", { name: "组件", exact: true })
      .click();
    const catalog = p.locator(".component-catalog"),
      page = p.locator(".library-page"),
      drawer = p.locator(".component-drawer");
    const first = catalog.locator('[data-component="mfg-renodx"]'),
      toggle = first.locator(".component-history-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const aligned = await catalog
      .locator(".component-history-toggle")
      .evaluateAll((items) =>
        items.map((el) => ({
          x: el.getBoundingClientRect().x,
          w: el.getBoundingClientRect().width,
        })),
      );
    assert.ok(aligned.length > 2);
    assert.ok(
      aligned.every(
        (r) =>
          Math.abs(r.x - aligned[0].x) < 2 && Math.abs(r.w - aligned[0].w) < 2,
      ),
      "History controls share an aligned column",
    );
    await toggle.click();
    await expect(first.locator("[data-version-id]")).toHaveCount(3);
    const release = first.locator('[data-version-id="release:mfg-test"]');
    const originalWidth = (
      await catalog.locator(".component-list").boundingBox()
    ).width;
    const reads = (await p.evaluate(() => window.qa.audit())).libraryReads;
    await release.locator(".component-status").click();
    await expect(drawer).toBeVisible();
    const widths = await catalog.locator(".component-list").boundingBox();
    assert.ok(
      widths.width < originalWidth - 250,
      "Opening details reserves list space",
    );
    await expect(drawer.locator(".component-support-badge")).toContainText(
      "尚未接入",
    );
    await expect(drawer.locator(".component-project-evidence")).toContainText(
      "RTX 30",
    );
    await expect(
      drawer.getByRole("heading", { name: "支持范围与测试记录", exact: true }),
    ).toBeVisible();
    await expect(
      drawer.locator(".component-detail-section summary"),
    ).toHaveCount(0);
    await expect(
      drawer.locator(".component-project-links .source-link").first(),
    ).toBeVisible();
    const cachedState = await release.locator(".component-status").innerText();
    await drawer.getByRole("button", { name: "下载入库", exact: true }).click();
    await p.waitForFunction(
      () => window.qa.audit().libraryDownload === "mfg-test",
    );
    await expect(release.locator(".component-status")).toHaveText(cachedState);
    await p.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    assert.ok(
      await release
        .locator(".component-status")
        .evaluate((el) => el === document.activeElement),
      "Focus returns to the invoking row",
    );
    assert.ok(
      Math.abs(
        (await catalog.locator(".component-list").boundingBox()).width -
          originalWidth,
      ) < 2,
      "Closing restores full list width",
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await catalog.getByRole("textbox", { name: "搜索组件" }).fill("1.9.0");
    await expect(catalog.locator("[data-version-id]")).toHaveCount(1);
    await release.locator(".component-status").click();
    await drawer.getByRole("button", { name: "关闭详情" }).click();
    await expect(drawer).toHaveCount(0);
    await expect(
      catalog.getByRole("textbox", { name: "搜索组件" }),
    ).toHaveValue("1.9.0");
    await catalog.getByRole("textbox", { name: "搜索组件" }).fill("");
    await page.evaluate((el) => (el.scrollTop = 180));
    const before = await page.evaluate((el) => el.scrollTop);
    await first
      .locator(".component-status")
      .first()
      .evaluate((el) => el.click());
    await expect(drawer).toBeVisible();
    await p.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    assert.ok(
      Math.abs((await page.evaluate((el) => el.scrollTop)) - before) < 3,
      "Closing preserves the list scroll offset",
    );
    await page.evaluate((el) => (el.scrollTop = 0));
    await release.locator(".component-status").click();
    await expect(
      drawer.getByRole("button", { name: "下载入库", exact: true }),
    ).toBeInViewport();
    if (output)
      await p.screenshot({
        path: path.join(output, "component-panel-desktop.png"),
        animations: "disabled",
      });
    await p.setViewportSize({ width: 960, height: 800 });
    await p.evaluate(() => (document.documentElement.dataset.theme = "light"));
    const fit = await drawer.evaluate((el) => ({
      w: el.clientWidth,
      scroll: el.scrollWidth,
    }));
    assert.ok(fit.scroll <= fit.w + 1, JSON.stringify(fit));
    await expect(
      drawer.getByRole("button", { name: "关闭详情" }),
    ).toBeInViewport();
    await expect(
      drawer.getByRole("button", { name: "下载入库", exact: true }),
    ).toBeInViewport();
    if (output)
      await p.screenshot({
        path: path.join(output, "component-panel-compact.png"),
        animations: "disabled",
      });
    assert.ok(
      (await p.evaluate(() => window.qa.audit())).libraryReads <= reads + 1,
      "Opening and filtering details do not reread the library",
    );
    await drawer.getByRole("button", { name: "关闭详情" }).click();
    await expect(drawer).toHaveCount(0);
    await release.locator(".component-status").click();
    await p
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await p.keyboard.press("Escape");
    await expect(drawer).toHaveCount(1);
    await p.getByRole("combobox", { name: "语言", exact: true }).click();
    await p.getByRole("option", { name: "English", exact: true }).click();
    await p.waitForFunction(() => window.qa.audit().language === "en");
    await p
      .getByRole("navigation")
      .getByRole("button", { name: "Components", exact: true })
      .click();
    await expect(
      drawer.getByRole("heading", {
        name: "NeuralFrame support",
        exact: true,
      }),
    ).toBeVisible();
    const englishFit = await drawer.evaluate((el) => ({width:el.clientWidth,content:el.scrollWidth}));
    assert.ok(englishFit.content <= englishFit.width + 1, "English text fits the compact drawer");
    await expect(drawer.locator("footer").getByRole("button", {name:"Download to library",exact:true})).toBeInViewport();
    if (output) await p.screenshot({path:path.join(output,"component-panel-english.png"),animations:"disabled"});
    await drawer.getByRole("button", { name: "Close details", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    assert.equal(
      (await p.evaluate(() => window.qa.audit())).requests.length,
      0,
      "Panel interactions never apply game settings",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Component panel passed: distinct evidence/support/file states, history alignment, drawer layout/focus/scroll, filtering, download isolation and compact layout.",
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
