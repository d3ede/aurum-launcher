import { test, expect } from "@playwright/test";
test("language picker, instant switch, persistence and RTL layout", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const remote: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(baseURL!).origin)
      remote.push(r.url());
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("aurum:language"))
      localStorage.setItem("aurum:language", "ru");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Выбор языка", exact: true }).click();
  await page.screenshot({
    path: "docs/screenshots/languages-picker.png",
    animations: "disabled",
  });
  await page
    .getByRole("textbox", { name: "Поиск языков", exact: true })
    .fill("spanish");
  await page.getByRole("button", { name: "Español", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("heading", { name: "Ajustes", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/languages-spanish.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.locator(".language-current").click();
  await page.locator(".language-search input").fill("україн");
  await page.getByRole("button", { name: "Українська", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "uk");
  await page.getByRole("button", { name: "Головна", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Головна", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Налаштування", exact: true }).click();
  await page.locator(".language-current").click();
  await page.locator(".language-search input").fill("arabic");
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.screenshot({
    path: "docs/screenshots/languages-arabic.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 960, height: 680 });
  expect(
    await page.evaluate(() => {
      const c = document.querySelector(".content-scroll")!;
      return (
        c.scrollWidth > c.clientWidth ||
        document.documentElement.scrollWidth > innerWidth
      );
    }),
  ).toBe(false);
  await page.locator(".language-current").click();
  await page.locator(".language-search input").fill("eesti");
  await page.getByRole("button", { name: "Eesti", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "et");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.locator(".language-current").click();
  await page.locator(".language-search input").fill("日本");
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "設定", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
