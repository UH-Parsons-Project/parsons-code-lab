// @ts-check
import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Faded Parsons Problems/);
});

test('shows login form on front page', async ({ page }) => {
  await page.goto('/');

  // Check that the login form and its fields are visible
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('#login-btn')).toBeVisible();
});

test('hides exercises button when logged out', async ({ page }) => {
  await page.goto('/');

  // Check that the exercises button is hidden when not logged in
  await expect(page.locator('#exercises-btn')).toBeHidden();
});

test('login form blocks submit when username and/or password missing', async ({ page }) => {
  await page.goto('/');

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

