import { expect, type Page } from "@playwright/test";

export async function viewEvidenceInReport(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("mark")).toBeVisible();
  await expect(dialog.locator("time")).toHaveAttribute("datetime", /T/);
  await dialog.getByRole("link", { name: "View evidence in report" }).click();
  await expect(dialog).toBeHidden();
}
