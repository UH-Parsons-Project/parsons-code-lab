// @ts-check
import { test, expect } from '@playwright/test';
import { arrangeParsonsSolution, setupStudentTask } from './test-helpers.js';

test('student task progress, block arrangement and blank values are persisted across page reload', async ({ page, browser }) => {
  const unique = Date.now();
  const { studentPage, studentContext } = await setupStudentTask(page, browser, {
    unique,
    teacherPrefix: 'teacher_sp',
    taskSetPrefix: 'SP Task Set',
    studentPrefix: 'st_sp',
  });

  // Arrange blocks in a specific custom order and fill in blanks
  const arrangement = await arrangeParsonsSolution(studentPage, [
    { match: 'def add_in_range', indent: 0 },
    { match: 'total =', indent: 1, inputs: ['42'] },
    { match: 'while', indent: 1, inputs: ['my_start', 'my_stop'] },
    { match: 'total +=', indent: 2, inputs: ['my_val'] },
    { match: 'start +=', indent: 2 },
    { match: 'return total', indent: 1 },
  ]);

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
