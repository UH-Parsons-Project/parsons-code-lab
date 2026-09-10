// @ts-check
/* eslint-env node */
import { test, expect } from '@playwright/test';
import { registerTeacher, loginTeacher, createTaskSet, registerStudent, loginStudent, getStudentUrl } from './test-helpers.js';

let studentUrl = '';

// Create a teacher account and a task set ONCE for all student auth tests
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const unique = Date.now();
  const teacherUsername = `teacher_${unique}`;
  const teacherEmail = `teacher_${unique}@example.com`;
  const teacherPassword = 'password123';

  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
  await expect(page.locator('#alert-placeholder .alert-success')).toContainText(
    'Registration successful.'
  );

  await loginTeacher(page, teacherEmail, teacherPassword);
  await createTaskSet(
    page,
    `Student Test List ${unique}`,
    `Student description for Student Test List ${unique}.`,
    `Teacher description for Student Test List ${unique}.`
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  studentUrl = (await getStudentUrl(page, `Student Test List ${unique}`)).trim();
  await page.close();
});

test('student cannot login with non-registered credentials', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  // Attempt to login with invalid credentials
  await loginStudent(studentPage, 'invalid@example.com', 'wrong_password');

  // Expect an error message about invalid credentials
  await studentPage.waitForSelector('#error-message:not([style*="display: none"])', { timeout: 10000 });
  await expect(studentPage.locator('#error-message')).toContainText(
    'Incorrect email or password'
  );
});

test('student can register and then login from task set page', async ({ browser }) => {
  // Start the test from the student tasklist URL in a fresh browser
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  // Register a new student account
  const unique = Date.now() % 1000000;
  const studentUsername = `student_${unique}`;
  const studentEmail = `student_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);

  // Registration now auto-logs in and redirects straight to /tasks.
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });
  await expect(studentPage).toHaveURL(studentUrl + '/tasks');
});

test('student registration fails with too short username', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  const unique = Date.now() % 1000000;
  const studentUsername = 'abc'; // Too short (< 5)
  const studentEmail = `student_short_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);

  await studentPage.waitForSelector('#alert-placeholder .alert-danger', { timeout: 10000 });
  await expect(studentPage.locator('#alert-placeholder .alert-danger')).toContainText(
    'username must have a minimum length of 5 characters'
  );
});

test('student registration fails with existing email', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  const unique = Date.now() % 1000000;
  const studentUsername1 = `student_dup1_${unique}`;
  const studentUsername2 = `student_dup2_${unique}`;
  const studentEmail = `student_dup_${unique}@example.com`;

  // First registration succeeds
  await registerStudent(studentPage, studentUsername1, studentEmail);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Go back to student login page and try second registration with same email
  await studentPage.goto(studentUrl);
  await registerStudent(studentPage, studentUsername2, studentEmail);

  await studentPage.waitForSelector('#alert-placeholder .alert-danger', { timeout: 10000 });
  await expect(studentPage.locator('#alert-placeholder .alert-danger')).toContainText(
    'Email already exists'
  );
});

test('student registration enforces max length on username', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  const unique = Date.now() % 1000000;
  const studentUsername = 'a'.repeat(25); // > 20 characters
  const studentEmail = `student_long_${unique}@example.com`;

  await studentPage.locator('#register-btn').click();
  await studentPage.waitForSelector('#register-form', { timeout: 10000 });

  // Bypassing HTML maxlength to test backend validation
  await studentPage.evaluate(() => {
    const usernameInput = document.getElementById('username');
    if (usernameInput) usernameInput.removeAttribute('maxlength');
  });

  await studentPage.locator('#username').fill(studentUsername);
  await studentPage.locator('#email').fill(studentEmail);
  await studentPage.locator('#password').fill('password123');
  await studentPage.locator('#password_confirm').fill('password123');
  await studentPage.locator('#register-form button[type="submit"]').click();

  await studentPage.waitForSelector('#alert-placeholder .alert-danger', { timeout: 10000 });
  await expect(studentPage.locator('#alert-placeholder .alert-danger')).toContainText(
    'username or email too long'
  );
});

test('student registration handles invalid email format via HTML validation', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  const unique = Date.now() % 1000000;
  const studentUsername = `student_inv_${unique}`;
  const studentEmail = `invalid-email-format`; // Missing @

  await studentPage.locator('#register-btn').click();
  await studentPage.waitForSelector('#register-form', { timeout: 10000 });

  await studentPage.locator('#username').fill(studentUsername);
  await studentPage.locator('#email').fill(studentEmail);
  await studentPage.locator('#password').fill('password123');
  await studentPage.locator('#password_confirm').fill('password123');
  
  await studentPage.locator('#register-form button[type="submit"]').click();

  // The form should not submit due to HTML5 validation. Check the validity state of the input.
  const isEmailInvalid = await studentPage.locator('#email').evaluate(el => !el.checkValidity());
  expect(isEmailInvalid).toBeTruthy();
  
  // Ensure no request was sent by waiting a bit and checking alert wasn't shown
  await studentPage.waitForTimeout(1000);
  const alertCount = await studentPage.locator('#alert-placeholder .alert-success').count();
  expect(alertCount).toBe(0);
});

test('student can logout and is redirected to login', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  const unique = Date.now() % 1000000;
  const studentUsername = `st_lo_${unique}`;
  const studentEmail = `student_lo_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Now logout
  const toggle = studentPage.locator('#navbar-burger-toggle');
  if (await toggle.isVisible()) {
    await toggle.click();
  }
  await studentPage.locator('#logout-btn').click();

  // Verify redirect back to the task set main login/register page
  await studentPage.waitForURL(studentUrl, { timeout: 10000 });
  await expect(studentPage.locator('#login-form')).toBeVisible();
});

test('student is redirected to login if attempting to access tasks without session', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  
  // Directly navigate to tasks URL without logging in
  await studentPage.goto(studentUrl + '/tasks');

  // Should redirect back to the student login page
  await studentPage.waitForURL(studentUrl, { timeout: 10000 });
  await expect(studentPage.locator('#login-form')).toBeVisible();
});

test('student session expiry redirects to login', async ({ browser }) => {
  const context = await browser.newContext();
  const studentPage = await context.newPage();
  await studentPage.goto(studentUrl);

  const unique = Date.now() % 1000000;
  const studentUsername = `st_exp_${unique}`;
  const studentEmail = `student_exp_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);
  await studentPage.goto(studentUrl);
  await loginStudent(studentPage, studentEmail);
  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Simulate session expiry by clearing cookies and localStorage
  await context.clearCookies();
  await studentPage.evaluate(() => localStorage.clear());

  // Reload page to trigger auth check
  await studentPage.reload();

  // Verify redirected to login
  await studentPage.waitForURL(studentUrl, { timeout: 10000 });
  await expect(studentPage.locator('#login-form')).toBeVisible();
});
