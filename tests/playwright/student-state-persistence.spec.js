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
  const teacherUsername = `teacher_sp_${unique}`;
  const teacherEmail = `teacher_sp_${unique}@example.com`;
  const teacherPassword = 'password123';
  const taskSetTitle = `SP Task Set ${unique}`;

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
  const studentUsername = `st_sp_${unique % 1000000}`;
  const studentEmail = `student_sp_${unique}@example.com`;

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

test('student task progress, block arrangement and blank values are persisted across page reload', async ({ page, browser }) => {
  const unique = Date.now();
  const { studentPage, studentContext } = await setupStudentTask(page, browser, unique);

  // Arrange blocks in a specific custom order and fill in blanks
  const arrangement = await studentPage.evaluate(() => {
    const pe = document.querySelector('problem-element');
    const widget = pe?.parsonsWidget;
    if (!widget) return null;
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

    // Fill in inputs
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

    setInputs(ordered[1], ['42']); // Set total to 42
    setInputs(ordered[2], ['my_start', 'my_stop']); // Set while bounds
    setInputs(ordered[3], ['my_val']); // Set total increment

    // Dispatch the arrangement-changed event to trigger saving to localStorage
    const currentArrangement = pe.getCurrentArrangement();
    pe.dispatchEvent(new CustomEvent('arrangement-changed', {
      detail: { arrangement: currentArrangement },
      bubbles: true,
    }));

    return currentArrangement;
  });

  expect(arrangement).not.toBeNull();

  // Verify it exists in localStorage
  const localStorageStateBefore = await studentPage.evaluate(() => {
    return JSON.stringify(localStorage);
  });
  expect(localStorageStateBefore).toContain('-repr');
  expect(localStorageStateBefore).toContain('42');
  expect(localStorageStateBefore).toContain('my_start');

  // Reload the page
  await studentPage.reload();
  await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });

  // Verify that the layout and input values are restored correctly from localStorage
  const restoredValues = await studentPage.evaluate(() => {
    const pe = document.querySelector('problem-element');
    if (!pe) return null;
    const solutionUl = pe.solutionRef.value?.querySelector('ul');
    if (!solutionUl) return null;
    const lis = Array.from(solutionUl.querySelectorAll('li'));
    
    // Get text and input values for each line in solution area
    return lis.map(li => {
      const codeText = li.textContent || '';
      const inputs = Array.from(li.querySelectorAll('input.text-box')).map(inp => inp.value);
      return { codeText, inputs };
    });
  });

  expect(restoredValues).not.toBeNull();
  
  // Verify that total = 42 was restored
  const totalLine = restoredValues.find(line => line.codeText.includes('total ='));
  expect(totalLine).toBeDefined();
  expect(totalLine.inputs).toContain('42');

  // Verify while loops restored with 'my_start' and 'my_stop'
  const whileLine = restoredValues.find(line => line.codeText.includes('while'));
  expect(whileLine).toBeDefined();
  expect(whileLine.inputs).toContain('my_start');
  expect(whileLine.inputs).toContain('my_stop');

  await studentContext.close();
});
