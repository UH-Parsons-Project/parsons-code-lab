// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Static & Information Pages E2E', () => {
  test('instructions page renders correctly', async ({ page }) => {
    await page.goto('/instructions');
    await expect(page).toHaveURL(/\/instructions$/);
    await expect(page).toHaveTitle(/Instructions - Parsons Code Lab/);
    await expect(page.locator('body')).toContainText('Parsons Code Lab');
  });

  test('privacy policy page renders policy content', async ({ page }) => {
    await page.goto('/privacy-policy');
    await expect(page).toHaveURL(/\/privacy-policy$/);
    await expect(page.locator('h1')).toHaveText('Privacy Policy');
    await expect(page.locator('body')).toContainText('General Data Protection Regulation');
  });

  test('contact page renders contact information', async ({ page }) => {
    await page.goto('/contact');
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('forgot password button on login form redirects to contact page', async ({ page }) => {
    await page.goto('/');
    const forgotPasswordLink = page.locator('#login-form #forgot-password-btn');
    await expect(forgotPasswordLink).toBeVisible();
    await forgotPasswordLink.click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator('h1')).toHaveText('Contact');
  });
});
