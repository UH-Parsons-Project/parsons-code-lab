// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
  registerStudent,
  loginStudent,
  getStudentUrl,
} from './test-helpers.js';

async function setupStudentTask(page, browser, unique) {
  const teacherUsername = `teacher_err_${unique}`;
  const teacherEmail = `teacher_err_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `Err Task Set ${unique}`;

  // Teacher registers, logs in, and creates a task set with specific tasks
  await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
  await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

  await loginTeacher(page, teacherEmail, teacherPassword);
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  await createTaskSetWithTasks(
    page,
    taskSetTitle,
    `Student description for ${taskSetTitle}`,
    `Teacher description for ${taskSetTitle}`,
    ['add_in_range']
  );
  await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

  // Get the student-facing URL
  const studentUrl = await getStudentUrl(page, taskSetTitle);

  // Open a new browser context for the student
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(studentUrl);

  // Register and login as student (username must be ≤20 chars due to HTML maxlength)
  const studentUsername = `st_err_${unique % 1000000}`;
  const studentEmail = `student_err_${unique}@example.com`;

  await registerStudent(studentPage, studentUsername, studentEmail);

  const loginResponsePromise = studentPage.waitForResponse(
    r => r.url().includes('/api/student_login')
  );

  await loginStudent(studentPage, studentEmail);
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);

  await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

  // Click on the "add_in_range" task
  await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();

  // Click "Start" on the start page
  await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
  await studentPage.locator('#start-btn').click();

  // Wait for Run Tests button to be available
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });

  return { studentPage, studentContext };
}

test('student task displays a friendly error for an infinite loop', async ({ page, browser }) => {
  const unique = Date.now();
  const { studentPage, studentContext } = await setupStudentTask(page, browser, unique);

  // Arrange blocks to form an infinite loop (omit the increment block 'start +=')
  await studentPage.evaluate(() => {
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
      // Omit findId('start +=') to cause infinite loop!
      findId('return total'),
    ].filter(Boolean);

    const indentMap = {};
    ordered.forEach((id) => {
      if (id === findId('def add_in_range')) indentMap[id] = 0;
      else if (id === findId('total =')) indentMap[id] = 1;
      else if (id === findId('while')) indentMap[id] = 1;
      else if (id === findId('total +=')) indentMap[id] = 2;
      else if (id === findId('return total')) indentMap[id] = 1;
    });

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
  });

  // Intercept setTimeout in the student page to speed up the worker timeout
  await studentPage.evaluate(() => {
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = function(handler, timeout, ...args) {
      if (timeout === 30000) {
        // Speed up the worker timeout to 2 seconds for testing
        return originalSetTimeout(handler, 2000, ...args);
      }
      return originalSetTimeout(handler, timeout, ...args);
    };
  });

  // Click Run Tests
  await studentPage.getByRole('button', { name: 'Run Tests' }).click();

  // Wait for results element
  await expect(studentPage.locator('problem-element')).toHaveAttribute('resultsstatus', /.+/, { timeout: 10000 });

  // Assert results show the infinite loop error
  const summary = studentPage.locator('.test-result-badge');
  const details = studentPage.locator('test-results-element .test-results-details');

  await expect(summary).toHaveText('Infinite loop');
  await expect(details).toContainText('Your code did not finish executing within 60 seconds');

  await studentContext.close();
});

test('student task displays a syntax error when code has invalid syntax', async ({ page, browser }) => {
  const unique = Date.now();
  const { studentPage, studentContext } = await setupStudentTask(page, browser, unique);

  // Arrange blocks in the correct order but set invalid input for a blank to trigger a SyntaxError
  await studentPage.evaluate(() => {
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
    ordered.forEach((id) => {
      if (id === findId('def add_in_range')) indentMap[id] = 0;
      else if (id === findId('total =')) indentMap[id] = 1;
      else if (id === findId('while')) indentMap[id] = 1;
      else if (id === findId('total +=')) indentMap[id] = 2;
      else if (id === findId('start +=')) indentMap[id] = 2;
      else if (id === findId('return total')) indentMap[id] = 1;
    });

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

    // total = 0 + (  <-- syntax error!
    setInputs(ordered[1], ['0 + (']);
    setInputs(ordered[2], ['start', 'stop']);
    setInputs(ordered[3], ['start']);
    setInputs(ordered[4], ['1']);
  });

  // Click Run Tests
  await studentPage.getByRole('button', { name: 'Run Tests' }).click();

  // Wait for results element
  await expect(studentPage.locator('problem-element')).toHaveAttribute('resultsstatus', /.+/, { timeout: 10000 });

  // Assert results show the SyntaxError
  const summary = studentPage.locator('.test-result-badge');
  const details = studentPage.locator('test-results-element .test-results-details');

  await expect(summary).toHaveText('SyntaxError');
  await expect(details).toContainText('Error at line');

  await studentContext.close();
});
