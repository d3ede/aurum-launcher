import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("aurum:language"))
      localStorage.setItem("aurum:language", "ru");
  });
});
test("honest browser state, navigation and persistent appearance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Главная" })).toBeVisible();
  await expect(page.getByText("Создайте первую сборку")).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "docs/screenshots/dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Каталог проектов", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Каталог ждёт в desktop-приложении" }),
  ).toBeVisible();
  await expect(page.locator(".catalog-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Аккаунты и скины", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Нет аккаунтов" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Локальный профиль", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "Ник игрока" }).fill("AurenTest");
  await page.getByRole("button", { name: "Добавить профиль" }).click();
  await expect(page.getByRole("alert")).toContainText("desktop-приложении");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Внешний вид" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Тёплый свет" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "docs/screenshots/settings.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
test("dialog keyboard trap and actual unavailable install state", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Создать сборку" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("desktop-приложении");
  await expect(
    dialog.getByRole("button", { name: "Создать сборку", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Отмена" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Закрыть диалог" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
test("layout at minimum desktop size has no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        document.querySelector(".content-scroll")!.scrollWidth >
        document.querySelector(".content-scroll")!.clientWidth,
    ),
  ).toBe(false);
});

test("styled menus support keyboard, dismissal and nested dialogs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Каталог проектов", exact: true })
    .click();
  const filters = await page
    .getByRole("complementary", { name: "Фильтры проектов" })
    .boundingBox();
  const results = await page.locator(".catalog-results").boundingBox();
  expect(filters!.x).toBeGreaterThan(results!.x + results!.width);
  const sort = page.getByRole("combobox", { name: "Сортировка проектов" });
  await sort.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "По загрузкам", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: "docs/screenshots/dropdown-light.png",
    animations: "disabled",
  });
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "Новые проекты", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sort).toHaveText("Новые проекты");
  await expect(sort).toBeFocused();
  await sort.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(sort).toBeFocused();
  await sort.click();
  const heading = await page.locator("h1").boundingBox();
  await page.mouse.click(heading!.x + 12, heading!.y + 12);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await sort.click();
  await page.screenshot({
    path: "docs/screenshots/dropdown-dark.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 960, height: 680 });
  expect(
    await page.evaluate(() => {
      const e = document.querySelector(".content-scroll")!;
      return (
        e.scrollWidth > e.clientWidth ||
        document.documentElement.scrollWidth > innerWidth
      );
    }),
  ).toBe(false);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать сборку", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("alert").waitFor();
  await dialog
    .getByRole("combobox", { name: "Загрузчик", exact: true })
    .click();
  await page.getByRole("option", { name: "Fabric", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await page.locator('.skin-stage canvas[data-ready="true"]').waitFor();
  await page.getByRole("button", { name: "Сбросить ракурс" }).click();
  await page.screenshot({
    path: "docs/screenshots/steve.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Выбрать скин Alex", exact: true })
    .click();
  await page
    .locator('canvas[aria-label="Предпросмотр скина"][data-ready="true"]')
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/alex.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
