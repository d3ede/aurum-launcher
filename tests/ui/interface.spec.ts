import { test, expect } from "@playwright/test";
test("honest browser state, navigation and persistent appearance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Хороший день для нового мира." }),
  ).toBeVisible();
  await expect(page.getByText("Место для вашей первой сборки")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/light.png", fullPage: true, animations: 'disabled' });
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "docs/screenshots/dark.png", fullPage: true, animations: 'disabled' });
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
    page.getByRole("heading", { name: "Кто отправится в приключение?" }),
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
    animations: 'disabled',
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
