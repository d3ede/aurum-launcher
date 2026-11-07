import { expect, test } from "@playwright/test";

test("Ukrainian covers the main screens, theme editor and dialogs at minimum size", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("aurum:language", "uk");
  });
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Головна", exact: true }),
  ).toBeVisible();

  async function checkScreen() {
    await expect(page.locator("html")).toHaveAttribute("lang", "uk");
    await expect(page.locator("body")).not.toContainText(/[ыэёъ�⁇]|@social\./i);
    expect(
      await page
        .locator(".content-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(false);
    const untranslated = await page
      .locator("input, button, [aria-label]")
      .evaluateAll((elements) =>
        elements
          .flatMap((el) => [
            el.getAttribute("aria-label"),
            el.getAttribute("placeholder"),
          ])
          .filter((value) => value && /[ыэёъ�⁇]|@social\./i.test(value)),
      );
    expect(untranslated).toEqual([]);
  }
  await checkScreen();
  await page.screenshot({
    path: ".test-data/screenshots/uk-home.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Мої збірки", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Мої збірки", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Немає збірок", exact: true }),
  ).toBeVisible();
  await checkScreen();
  await page.getByRole("button", { name: "Нова збірка", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Створити збірку", exact: true }),
  ).toBeDisabled();
  await checkScreen();
  await page.screenshot({
    path: ".test-data/screenshots/uk-create-instance.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Налаштування", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Мова інтерфейсу", exact: true }),
  ).toBeVisible();
  await checkScreen();
  await page
    .getByRole("button", { name: "Зовнішній вигляд", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Світлі теми", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Гранатовий шовк", exact: true }),
  ).toHaveCount(1);
  await checkScreen();
  await page.screenshot({
    path: ".test-data/screenshots/uk-appearance.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Створити темну тему/ }).click();
  await expect(
    page.getByRole("heading", { name: "Створення темної теми", exact: true }),
  ).toBeVisible();
  await checkScreen();
  await page.screenshot({
    path: ".test-data/screenshots/uk-theme-editor.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Назад до зовнішнього вигляду", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Назад до налаштувань", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Головна сторінка", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Порядок блоків", exact: true }),
  ).toBeVisible();
  await checkScreen();
  await page.getByRole("button", { name: "Друзі", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Друзі", exact: true }),
  ).toBeVisible();
  await checkScreen();
  await page.getByRole("button", { name: "Хостинг", exact: true }).click();
  await checkScreen();
  await page.screenshot({
    path: ".test-data/screenshots/uk-hosting.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Головна", exact: true }),
  ).toBeVisible();
  await checkScreen();
  expect(errors).toEqual([]);
});
