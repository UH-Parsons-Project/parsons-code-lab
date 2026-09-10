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

test.describe('Student Task Statistics & Timeline Replay E2E', () => {
  let unique;
  let teacherUsername;
  let teacherEmail;
  let teacherPassword;
  let taskSetTitle;
  let studentUrl;
  let studentUsername;
  let studentEmail;

  test.beforeEach(async ({ page, browser }) => {
    unique = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    teacherUsername = `teacher_rp_${unique}`;
    teacherEmail = `teacher_rp_${unique}@example.com`;
    teacherPassword = 'password123';
    taskSetTitle = `Replay Task Set ${unique}`;

    // 1. Teacher registers and creates task set
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    await createTaskSetWithTasks(
      page,
      taskSetTitle,
      `Student description for replay test`,
      `Teacher description for replay test`,
      ['add_in_range']
    );
    await page.waitForURL(/\/teacher-dashboard$/, { timeout: 10000 });

    studentUrl = await getStudentUrl(page, taskSetTitle);

    // 2. Student registers, logs in, and completes task attempts and moves
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    studentUsername = `st_rp_${Date.now() % 1000000}`;
    studentEmail = `student_rp_${unique}@example.com`;

    await registerStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // Open task
    await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
    await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
    await studentPage.locator('#start-btn').click();

    // Wait for problem element
    await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });

    // Perform moves in problem element
    await studentPage.evaluate(() => {
      const pe = document.querySelector('problem-element');
      const widget = pe?.parsonsWidget;
      if (!widget) return;

      const findId = (substr) => {
        const l = widget.modified_lines.find(x => x.code && x.code.includes(substr));
        return l ? l.id : null;
      };

      const idDef = findId('def add_in_range');
      const idTotal = findId('total =');
      const solutionIds = [idDef, idTotal].filter(Boolean);
      const trashIds = widget.modified_lines.map(l => l.id).filter(id => !solutionIds.includes(id));

      widget.createHTMLFromLists(solutionIds, trashIds);

      // Trigger arrangement-changed event to record move
      pe.dispatchEvent(new CustomEvent('arrangement-changed', {
        detail: { arrangement: pe.getCurrentArrangement() },
        bubbles: true,
      }));
    });

    // Run tests (First attempt - fails)
    await studentPage.getByRole('button', { name: 'Run Tests' }).click();
    await studentPage.waitForSelector('test-results-element', { timeout: 30000 });

    await studentContext.close();
  });

  test('teacher can view student task statistics and replay timeline controls', async ({ page }) => {
    // 1. Teacher navigates to task set overview page
    await page.goto('/teacher-dashboard');
    await page.waitForSelector('.task-set-title', { timeout: 10000 });
    await page.locator('.task-set-title', { hasText: taskSetTitle }).click();

    // 2. Verify student is listed in students list and click student item
    await page.waitForSelector('#students-list', { timeout: 10000 });
    const studentItem = page.locator('.student-item', { hasText: studentUsername });
    await expect(studentItem).toBeVisible({ timeout: 10000 });
    await studentItem.click();

    // 3. Teacher lands on student attempts page (/student-attempts?student_id=...)
    await page.waitForURL(/\/student-attempts\?/, { timeout: 15000 });
    await page.waitForSelector('#attempts-container', { timeout: 15000 });

    // Click on the task item for add_in_range
    const taskItem = page.locator('.task-set-item', { hasText: 'add_in_range' });
    await expect(taskItem).toBeVisible({ timeout: 10000 });
    await taskItem.click();

    // 4. Teacher lands on student task statistics page (/student-task-statistics?...)
    await page.waitForURL(/\/student-task-statistics\?/, { timeout: 15000 });
    await page.waitForSelector('#content-container', { timeout: 15000 });

    // Verify Header & KPI strip
    await expect(page.locator('#exercise-name')).toContainText('add_in_range');
    await expect(page.locator('#student-name-text')).toContainText(studentUsername);
    await expect(page.locator('#stat-total')).toHaveText('1');

    // Verify Attempts List
    await expect(page.locator('#attempts-list .attempt-item')).toHaveCount(1);
    await expect(page.locator('#attempts-list .attempt-item')).toContainText('Attempt #1');

    // Verify Session Log Card
    await expect(page.locator('#sessions-list')).toBeVisible();

    // 5. Test Replay Timeline Player
    const replayToggle = page.locator('#replay-toggle');
    await replayToggle.click();
    await expect(page.locator('#replay-body')).not.toHaveClass(/collapsed/);

    const stepLabel = page.locator('#replay-step-label');
    await expect(stepLabel).toBeVisible();
    await expect(stepLabel).toContainText(/Step 0 \/ \d+/);

    // Test Replay Step Forward (Next button)
    const nextBtn = page.locator('#replay-next');
    await expect(nextBtn).toBeEnabled({ timeout: 10000 });
    await nextBtn.click();
    await expect(stepLabel).toContainText(/Step 1 \/ \d+/);

    // Verify event label updates to show timestamp/action
    await expect(page.locator('#replay-event-label')).not.toBeEmpty();

    // Test Replay Step Backward (Prev button)
    const prevBtn = page.locator('#replay-prev');
    await expect(prevBtn).toBeEnabled();
    await prevBtn.click();
    await expect(stepLabel).toContainText(/Step 0 \/ \d+/);

    // Test Slider Scrubber is enabled
    const slider = page.locator('#replay-slider');
    await expect(slider).toBeEnabled();
  });
});
