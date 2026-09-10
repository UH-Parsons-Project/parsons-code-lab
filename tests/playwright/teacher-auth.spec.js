// @ts-check
/* eslint-env node */
import { test, expect } from '@playwright/test';
import { registerTeacher, loginTeacher, logoutTeacher } from './test-helpers.js';

test('teacher can register and then login from the main page', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_${unique}`;
  const email = `teacher_${unique}@example.com`;
  const password = 'password123';

  // Register a new teacher account
  await registerTeacher(page, username, email, password);

  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-success')).toContainText(
    'Registration successful.'
  );

  // Login from the main page with the just-created credentials
  await loginTeacher(page, email, password);

  await expect(page).toHaveURL(/\/teacher-dashboard$/);
});

test('teacher can login using username instead of email', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_uname_${unique}`;
  const email = `teacher_uname_${unique}@example.com`;
  const password = 'password123';

  await registerTeacher(page, username, email, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, username, password);

  await expect(page).toHaveURL(/\/teacher-dashboard$/);
});

test('teacher cannot login with non-registered credentials', async ({ page }) => {
  await loginTeacher(page, 'nonexistent_teacher@example.com', 'wrong_password');

  await page.waitForSelector('#error-message:not([style*="display: none"])', { timeout: 10000 });
  await expect(page.locator('#error-message')).toContainText(
    'Incorrect username,email, or password'
  );
});

test('teacher can logout after successful login', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_logout_${unique}`;
  const email = `teacher_logout_${unique}@example.com`;
  const password = 'password123';

  await registerTeacher(page, username, email, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-success')).toContainText(
    'Registration successful.'
  );

  await loginTeacher(page, email, password);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  await logoutTeacher(page);
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#navbar-burger-menu')).toBeHidden();
});

test('registration shows error for duplicate username', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_dup_${unique}`;
  const email1 = `teacher_dup_${unique}@example.com`;
  const email2 = `teacher_dup_${unique}_2@example.com`;

  await registerTeacher(page, username, email1);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-success')).toContainText(
    'Registration successful.'
  );

  await registerTeacher(page, username, email2);
  await page.waitForSelector('#alert-placeholder .alert-danger', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-danger')).toContainText(
    'Username or email already exists'
  );
});

test('teacher registration fails with existing email', async ({ page }) => {
  const unique = Date.now();
  const username1 = `teacher_dupemail1_${unique}`;
  const username2 = `teacher_dupemail2_${unique}`;
  const email = `teacher_dupemail_${unique}@example.com`;

  await registerTeacher(page, username1, email);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-success')).toContainText(
    'Registration successful.'
  );

  await registerTeacher(page, username2, email);
  await page.waitForSelector('#alert-placeholder .alert-danger', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-danger')).toContainText(
    'Username or email already exists'
  );
});

test('registration shows error for invalid token', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_badtoken_${unique}`;
  const email = `teacher_badtoken_${unique}@example.com`;

  await registerTeacher(page, username, email, 'password123', 'wrong_token');

  await expect(page.locator('#alert-placeholder .alert-danger')).toContainText(
    'Invalid registration token'
  );
});

test('login shows error with wrong password', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_wrongpw_${unique}`;
  const email = `teacher_wrongpw_${unique}@example.com`;
  const password = 'password123';

  await registerTeacher(page, username, email, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-success')).toContainText(
    'Registration successful.'
  );

  await loginTeacher(page, email, 'wrong-password');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('Incorrect username,email, or password');
});

test('teacher registration fails with too short username', async ({ page }) => {
  const unique = Date.now();
  const username = 'abc'; // Too short (< 5)
  const email = `teacher_short_${unique}@example.com`;

  await registerTeacher(page, username, email);

  await page.waitForSelector('#alert-placeholder .alert-danger', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-danger')).toContainText(
    'username must have a minimum length of 5 characters'
  );
});

test('teacher registration enforces max length on username', async ({ page }) => {
  const unique = Date.now();
  const username = 'a'.repeat(55); // > 50 characters (teacher username_max is 50)
  const email = `teacher_long_${unique}@example.com`;

  await page.goto('/teacher-register');
  await page.waitForSelector('#register-form', { timeout: 10000 });

  // Bypassing HTML maxlength to test backend validation
  await page.evaluate(() => {
    const usernameInput = document.getElementById('username');
    if (usernameInput) usernameInput.removeAttribute('maxlength');
  });

  await page.locator('#username').fill(username);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password123');
  await page.locator('#password_confirm').fill('password123');
  await page.locator('#registration_token').fill(process.env.TEACHER_REGISTRATION_TOKEN || 'valid_token');
  await page.locator('#register-form button[type="submit"]').click();

  await page.waitForSelector('#alert-placeholder .alert-danger', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-danger')).toContainText(
    'username or email too long'
  );
});

test('teacher registration handles invalid email format via HTML validation', async ({ page }) => {
  const unique = Date.now();
  const username = `teacher_inv_${unique}`;
  const email = 'invalid-email-format';

  await page.goto('/teacher-register');
  await page.waitForSelector('#register-form', { timeout: 10000 });

  await page.locator('#username').fill(username);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password123');
  await page.locator('#password_confirm').fill('password123');
  await page.locator('#registration_token').fill(process.env.TEACHER_REGISTRATION_TOKEN || 'valid_token');

  await page.locator('#register-form button[type="submit"]').click();

  const isEmailInvalid = await page.locator('#email').evaluate(el => !el.checkValidity());
  expect(isEmailInvalid).toBeTruthy();

  await page.waitForTimeout(1000);
  const alertCount = await page.locator('#alert-placeholder .alert-success').count();
  expect(alertCount).toBe(0);
});

test('teacher is redirected to login if attempting to access dashboard without session', async ({ page }) => {
  await page.goto('/teacher-dashboard');

  await page.waitForURL(url => url.pathname === '/', { timeout: 10000 });
  await expect(page.locator('#login-form')).toBeVisible();
});

test('teacher session expiry redirects to login', async ({ page, context }) => {
  const unique = Date.now();
  const username = `teacher_exp_${unique}`;
  const email = `teacher_exp_${unique}@example.com`;
  const password = 'password123';

  await registerTeacher(page, username, email, password);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, email, password);
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  // Simulate session expiry by clearing cookies and localStorage
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  // Reload page to trigger auth check
  await page.reload();

  // Verify redirected to login
  await page.waitForURL(url => url.pathname === '/', { timeout: 10000 });
  await expect(page.locator('#login-form')).toBeVisible();
});

