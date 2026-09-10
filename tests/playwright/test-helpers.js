// @ts-check
/* eslint-env node */
/**
 * Shared test helper functions for Playwright tests
 */
import { expect } from '@playwright/test';

/**
 * Generate a random alphanumeric token
 * @param {number} length - Length of token (default 15)
 * @returns {string} Random token
 */
function generateRandomToken(length = 15) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Get a valid registration token
 * In test mode, tokens are created by the seed function from environment variable
 * @returns {string} A valid registration token
 */
function getTestRegistrationToken() {
  // The seed_db function creates this token during test setup
  // using the TEACHER_REGISTRATION_TOKEN environment variable
  return process.env.TEACHER_REGISTRATION_TOKEN || generateRandomToken(15);
}

/**
 * Register a teacher using a registration token
 * @param {any} page - Playwright page object
 * @param {string} username - Teacher username
 * @param {string} email - Teacher email
 * @param {string} password - Teacher password (default: 'password123')
 * @param {string} registrationToken - Registration token (default: from env or generated)
 */
export async function registerTeacher(
  page,
  username,
  email,
  password = 'password123',
  registrationToken = getTestRegistrationToken()
) {
  try {
    await page.goto('/teacher-register');
  } catch (err) {
    if (err.message && (err.message.includes('interrupted') || err.message.includes('ERR_ABORTED') || err.message.includes('Navigation'))) {
      await page.waitForTimeout(300);
      await page.goto('/teacher-register');
    } else {
      throw err;
    }
  }
  await page.locator('#username').fill(username);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#password_confirm').fill(password);
  await page.locator('#registration_token').fill(registrationToken);
  await page.locator('#register-form button[type="submit"]').click();
}

/**
 * Login a teacher
 * @param {any} page - Playwright page object
 * @param {string} username - Teacher username
 * @param {string} password - Teacher password
 */
export async function loginTeacher(page, username, password) {
  await page.request.post('/api/logout');
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
  });
  await page.reload();
  await page.waitForSelector('#login-form', { state: 'visible', timeout: 10000 });

  const usernameInput = page.locator('#login-form #username');
  const passwordInput = page.locator('#login-form #password');
  await expect(usernameInput).toBeVisible({ timeout: 10000 });
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await usernameInput.fill(username);
  await passwordInput.fill(password);

  await Promise.all([
    page.waitForURL(/\/teacher-dashboard$|\/$/, { timeout: 15000 }).catch(() => null),
    page.locator('#login-btn').click(),
  ]);
}

/**
 * Create a task set with random tasks
 * @param {any} page - Playwright page object
 * @param {string} taskSetTitle - Title of the task set
 * @param {string} studentDescription - Description for students
 * @param {string} teacherDescription - Description for teachers
 */
export async function createTaskSet(
  page,
  taskSetTitle,
  studentDescription,
  teacherDescription
) {
  await page.locator('a[href="/create-task-set"]').click();
  await page.locator('#task-set-title').fill(taskSetTitle);
  await page.locator('#student-description').fill(studentDescription);
  await page.locator('#teacher-description').fill(teacherDescription);
  await page.waitForSelector('.task-item', { timeout: 10000 });
  const taskItems = await page.locator('.task-item').all();
  const tasksToSelect = Math.min(3, taskItems.length);
  const selectedIndices = new Set();

  while (selectedIndices.size < tasksToSelect) {
    selectedIndices.add(Math.floor(Math.random() * taskItems.length));
  }

  for (const index of selectedIndices) {
    await taskItems[index].click();
  }

  await Promise.all([
    page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 }),
    page.locator('#create-task-set-form button[type="submit"]').click(),
  ]);
}

export async function createTaskSetWithTasks(page, taskSetTitle, studentDescription, teacherDescription, taskNames) {
  await page.locator('a[href="/create-task-set"]').click();
  await page.locator('#task-set-title').fill(taskSetTitle);
  await page.locator('#student-description').fill(studentDescription);
  await page.locator('#teacher-description').fill(teacherDescription);
  await page.waitForSelector('.task-item', { timeout: 10000 });

  for (const name of taskNames) {
    await page.locator('.task-item', { has: page.locator('.task-item-title', { hasText: name }) }).click();
  }

  await Promise.all([
    page.waitForURL(/\/teacher-dashboard/, { timeout: 15000 }),
    page.locator('#create-task-set-form button[type="submit"]').click(),
  ]);
}

export async function registerStudent(page, username, email, password = 'password123') {
  await page.request.post('/api/student_logout');

  const currentUrl = new URL(page.url());
  const taskSetMatch = currentUrl.pathname.match(/^\/([^/]+)\/set\/([^/]+)(?:\/tasks)?\/?$/);
  const registerUrl = taskSetMatch
    ? `/student-register?username=${encodeURIComponent(taskSetMatch[1])}&code=${encodeURIComponent(taskSetMatch[2])}`
    : '/student-register';
  await page.goto(registerUrl);
  await page.waitForSelector('#register-form', { state: 'visible', timeout: 10000 });

  await page.locator('#username').fill(username);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#password_confirm').fill(password);

  const registrationResult = Promise.race([
    page.waitForURL(/\/student\/profile$|\/tasks$/, { timeout: 15000 }),
    page.locator('#alert-placeholder .alert-danger').waitFor({
      state: 'visible',
      timeout: 15000,
    }),
  ]);
  await page.locator('#register-form button[type="submit"]').click();
  await registrationResult;
}

/**
 * Create a test student via API (faster than UI flow).
 * @param {any} page - Playwright page or request context
 * @param {string} username
 * @param {string} email
 * @param {string} password
 */
export async function createTestStudent(page, username, email, password = 'password123') {
  const resp = await page.request.post('/api/student_register', {
    data: {
      username,
      email,
      password,
      password_confirm: password,
    },
  });
  return resp;
}

export async function loginStudent(page, username, password = 'password123', uniqueLinkCode = null) {
  let loginUrl = page.url();
  await page.request.post('/api/student_logout');
  await page.waitForURL(/\/[^/]+\/set\/[^/]+\/?$/, { timeout: 5000 }).catch(() => null);
  loginUrl = page.url();
  await page.goto(loginUrl);
  await page.waitForSelector('#login-form', { state: 'visible', timeout: 10000 });

  const usernameInput = page.locator('#login-form #username');
  const passwordInput = page.locator('#login-form #password');
  await expect(usernameInput).toBeVisible({ timeout: 10000 });
  await expect(passwordInput).toBeVisible({ timeout: 10000 });

  await usernameInput.fill(username);
  await passwordInput.fill(password);

  if (uniqueLinkCode) {
    const hiddenCodeInput = page.locator('#login-form input[name="unique_link_code"]');
    if (await hiddenCodeInput.count()) {
      await hiddenCodeInput.fill(uniqueLinkCode);
    }
  }

  await Promise.all([
    page.waitForURL(/\/tasks$/, { timeout: 15000 }).catch(() => null),
    page.locator('#login-btn').click(),
  ]);
}

/**
 * Logout a teacher and wait for return to login page
 * @param {any} page - Playwright page object
 */
export async function logoutTeacher(page) {
  await page.locator('#navbar-burger-toggle').click();
  await page.locator('#logout-btn').click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForSelector('#login-form', { timeout: 10000 });
}

export async function getStudentUrl(page, taskSetTitle) {
  await Promise.all([
    page.waitForURL(/\/task-set-overview/, { timeout: 15000 }),
    page.locator('.task-set-title', { hasText: taskSetTitle }).click(),
  ]);
  await page.waitForSelector('#link-code', { timeout: 10000 });
  const studentUrl = (await page.locator('#link-code').textContent()).trim();
  return studentUrl;
}

/**
 * Start a Parsons task and submit a deliberately wrong solution, then correct it
 * and assert that the corrected submission passes. This encapsulates the
 * DOM manipulations performed in tests so other specs can reuse the flow.
 * @param {import('@playwright/test').Page} page - student page on the problem view (after clicking Start)
 */
export async function submitTaskWrongThenCorrect(page) {
  // Wait for Run Tests button available
  await page.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });

  // Phase 1: arrange a wrong solution and run tests
  await page.evaluate(() => {
    const pe = document.querySelector('problem-element');
    const widget = pe?.parsonsWidget;
    if (!widget) return;
    const findId = (substr) => {
      const l = widget.modified_lines.find(x => x.code && x.code.includes(substr));
      return l ? l.id : null;
    };

    const ordered = [
      findId('def add_in_range'),
      findId('total ='),
      findId('while'),
      findId('total +='),
      findId('start +='),
      findId('return total'),
    ].filter(Boolean);

    widget.createHTMLFromLists(ordered, widget.modified_lines.map(l => l.id).filter(id => !ordered.includes(id)));
    ordered.forEach(id => widget.updateHTMLIndent(id));

    const totalId = findId('total =');
    if (totalId) {
      const li = document.getElementById(totalId);
      const inp = li?.querySelector('input.text-box');
      if (inp) inp.value = '1';
    }
  });

  await page.getByRole('button', { name: 'Run Tests' }).click();
  await page.waitForSelector('test-results-element', { timeout: 30000 });
  await expect(page.locator('.test-result-badge.full-pass')).toHaveCount(0);

  // Phase 2: set correct ordering/indents and blanks, then run again
  await page.evaluate(() => {
    const pe = document.querySelector('problem-element');
    const widget = pe?.parsonsWidget;
    if (!widget) return;
    const findId = (substr) => {
      const l = widget.modified_lines.find(x => x.code && x.code.includes(substr));
      return l ? l.id : null;
    };

    const ordered = [
      findId('def add_in_range'),
      findId('total ='),
      findId('while'),
      findId('total +='),
      findId('start +='),
      findId('return total'),
    ].filter(Boolean);

    const indentMap = {};
    if (ordered[0]) indentMap[ordered[0]] = 0;
    if (ordered[1]) indentMap[ordered[1]] = 1;
    if (ordered[2]) indentMap[ordered[2]] = 1;
    if (ordered[3]) indentMap[ordered[3]] = 2;
    if (ordered[4]) indentMap[ordered[4]] = 2;
    if (ordered[5]) indentMap[ordered[5]] = 1;

    Object.entries(indentMap).forEach(([id, val]) => {
      const line = widget.getLineById(id);
      if (line) line.indent = val;
    });

    widget.createHTMLFromLists(ordered, widget.modified_lines.map(l => l.id).filter(id => !ordered.includes(id)));
    ordered.forEach(id => widget.updateHTMLIndent(id));

    const setInputs = (id, values) => {
      if (!id) return;
      const li = document.getElementById(id);
      if (!li) return;
      const inputs = Array.from(li.querySelectorAll('input.text-box'));
      values.forEach((v, i) => {
        if (inputs[i]) {
          inputs[i].value = v;
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          inputs[i].dispatchEvent(new Event('blur', { bubbles: true }));
        }
      });
    };

    setInputs(ordered[1], ['0']);
    setInputs(ordered[2], ['start', 'stop']);
    setInputs(ordered[3], ['start']);
    setInputs(ordered[4], ['1']);
  });

  await page.getByRole('button', { name: 'Run Tests' }).click();
  await page.waitForSelector('.test-result-badge.full-pass', { timeout: 30000 });
  await expect(page.locator('.test-result-badge.full-pass')).toBeVisible();
}

/**
 * Start a Parsons task for 'greater_num' and submit a correct solution
 * @param {import('@playwright/test').Page} page - student page on the problem view (after clicking Start)
 */
export async function submitGreaterNumCorrect(page) {
  await page.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });

  await page.evaluate(() => {
    const pe = document.querySelector('problem-element');
    const widget = pe?.parsonsWidget;
    if (!widget) return;
    
    const findId = (substr) => {
      const l = widget.modified_lines.find(x => x.code && x.code.includes(substr));
      return l ? l.id : null;
    };
    
    const findAll = (substr) => {
      return widget.modified_lines.filter(x => x.code && x.code.includes(substr)).map(l => l.id);
    };

    const returns = findAll('return ');

    const ordered = [
      findId('def greater_num(num1, num2):'),
      findId('if '),
      returns[0],
      findId('else:'),
      returns[1],
    ].filter(Boolean);

    const indentMap = {};
    if (ordered[0]) indentMap[ordered[0]] = 0;
    if (ordered[1]) indentMap[ordered[1]] = 1;
    if (ordered[2]) indentMap[ordered[2]] = 2;
    if (ordered[3]) indentMap[ordered[3]] = 1;
    if (ordered[4]) indentMap[ordered[4]] = 2;

    Object.entries(indentMap).forEach(([id, val]) => {
      const line = widget.getLineById(id);
      if (line) line.indent = val;
    });

    widget.createHTMLFromLists(ordered, widget.modified_lines.map(l => l.id).filter(id => !ordered.includes(id)));
    ordered.forEach(id => widget.updateHTMLIndent(id));
    
    const setInputs = (id, values) => {
      if (!id) return;
      const li = document.getElementById(id);
      if (!li) return;
      const inputs = Array.from(li.querySelectorAll('input.text-box'));
      values.forEach((v, i) => {
        if (inputs[i]) {
          inputs[i].value = v;
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          inputs[i].dispatchEvent(new Event('blur', { bubbles: true }));
        }
      });
    };

    setInputs(ordered[1], ['num1 > num2']);
    setInputs(ordered[2], ['num1']);
    setInputs(ordered[4], ['num2']);
  });

  await page.getByRole('button', { name: 'Run Tests' }).click();
  await page.waitForSelector('.test-result-badge.full-pass', { timeout: 30000 });
  await expect(page.locator('.test-result-badge.full-pass')).toBeVisible();
}
