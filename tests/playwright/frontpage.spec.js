// @ts-check
import { test, expect } from '@playwright/test';

test('has logo image', async ({ page }) => {
  await page.goto('/');

  // Check that the logo image is visible
  const logo = page.locator('img.navbar-logo');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', '/ohtuproj_logo.png');
  await expect(logo).toHaveAttribute('alt', 'Parsons Code Lab Logo');
});

test('front page login button opens the teacher login page', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#login-btn')).toHaveAttribute('href', '/teacher-login');
  await page.locator('#login-btn').click();
  await expect(page).toHaveURL(/\/teacher-login$/);
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('#login-btn')).toBeVisible();
});

test('teacher login page offers account and organization sign-in sections', async ({ page }) => {
  await page.goto('/teacher-login');

  await expect(page.locator('#account-login-heading')).toHaveText('Sign in with your account');
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('#institution-login-heading')).toHaveText('Sign in with your organization');
});

test('hides exercises button when logged out', async ({ page }) => {
  await page.goto('/');

  // Check that the exercises buttons are hidden when not logged in
  await expect(page.locator('#exercises-btn')).toBeHidden();
  await expect(page.locator('#global-stats-btn')).toBeHidden();
});

test('login form blocks submit when username and/or password missing', async ({ page }) => {
  await page.goto('/teacher-login');

  const usernameInput = page.locator('#username');
  const passwordInput = page.locator('#password');

  await expect(usernameInput).toHaveAttribute('required', '');
  await expect(passwordInput).toHaveAttribute('required', '');

  // Click login with both fields empty
  await page.locator('#login-btn').click();
  const usernameMissing = await usernameInput.evaluate(
    (el) => el.validity.valueMissing
  );
  expect(usernameMissing).toBeTruthy();

  // Fill username only, then click login again
  await usernameInput.fill('student');
  await page.locator('#login-btn').click();
  const passwordMissing = await passwordInput.evaluate(
    (el) => el.validity.valueMissing
  );
  expect(passwordMissing).toBeTruthy();

  // Clear username, fill password only, then click login
  await usernameInput.fill('');
  await passwordInput.fill('secret');
  await page.locator('#login-btn').click();
  const usernameMissingAgain = await usernameInput.evaluate(
    (el) => el.validity.valueMissing
  );
  expect(usernameMissingAgain).toBeTruthy();
});
