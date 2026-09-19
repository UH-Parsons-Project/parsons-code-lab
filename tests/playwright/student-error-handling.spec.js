// @ts-check
import { test, expect } from '@playwright/test';
import { setupStudentTask } from './test-helpers.js';

test('student task displays a friendly error for an infinite loop', async ({ page, browser }) => {
  const unique = Date.now();
  const { studentPage, studentContext } = await setupStudentTask(page, browser, {
    unique,
    teacherPrefix: 'teacher_err',
    taskSetPrefix: 'Err Task Set',
    studentPrefix: 'st_err',
  });

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
