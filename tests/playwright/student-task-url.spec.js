// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
  getStudentUrl,
  createTestStudent,
  loginStudent,
  submitTaskWrongThenCorrect,
} from './test-helpers.js';

test.describe('Task URL resilience and Task Reordering', () => {
  test('student session is not broken when teacher reorders tasks', async ({ browser }) => {
    test.setTimeout(90000); // Complex E2E needs extra time

    const unique = Date.now();
    const shortUnique = unique.toString().slice(-8);
    const teacherUsername = `t_${shortUnique}`;
    const teacherEmail = `t_${shortUnique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Reorder Resilience ${unique}`;

    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();

    // 1. Teacher registers and creates task set
    await registerTeacher(teacherPage, teacherUsername, teacherEmail, teacherPassword);
    await teacherPage.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(teacherPage, teacherEmail, teacherPassword);
    await expect(teacherPage).toHaveURL(/\/teacher-dashboard$/);

    const originalTaskNames = ['add_in_range', 'greater_num', 'hello_world'];
    await createTaskSetWithTasks(
      teacherPage,
      taskSetTitle,
      `Student description`,
      `Teacher description`,
      originalTaskNames
    );
    
    await teacherPage.waitForURL(/\/(teacher-dashboard|)$/, { timeout: 15000 });
    if (!teacherPage.url().includes('teacher-dashboard')) {
      await teacherPage.waitForURL(/\/teacher-dashboard$/, { timeout: 15000 });
    }

    const studentUrl = await getStudentUrl(teacherPage, taskSetTitle);
    await teacherPage.waitForSelector('.task-set-item', { state: 'visible', timeout: 10000 });
    
    // Extract set_id and current task ids to reorder later
    const setId = await teacherPage.evaluate(() => new URLSearchParams(window.location.search).get('set_id'));
    
    const taskItems = teacherPage.locator('.task-set-item');
    const taskIds = [];
    for (let i = 0; i < await taskItems.count(); i++) {
      taskIds.push(await taskItems.nth(i).getAttribute('data-task-id'));
    }
    expect(taskIds.length).toBe(3);

    const studentContext = await browser.newContext();
    
    // Disable cache for API requests so we see the fresh order
    await studentContext.route('**/api/my_sets/*/tasks', route => {
      route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache' } });
    });
    
    const studentPage = await studentContext.newPage();
    
    const studentUsername = `s_${shortUnique}`;
    const studentEmail = `s_${shortUnique}@example.com`;

    const regResp = await createTestStudent(studentPage, studentUsername, studentEmail);
    expect(regResp.ok()).toBeTruthy();
    
    await studentPage.goto(studentUrl);

    // Explicitly pass unique_link_code to login
    const urlParts = studentUrl.split('/set/');
    const uniqueLinkCode = urlParts.length > 1 ? urlParts[1].split('/')[0] : null;

    const loginResponsePromise = studentPage.waitForResponse(
      r => r.url().includes('/api/student_login')
    );
    await loginStudent(studentPage, studentEmail, 'password123', uniqueLinkCode);
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);

    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });
    
    // Student clicks on 'add_in_range'
    await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
    
    // Wait for the task details page to load
    await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
    
    // Verify the URL ends with a database ID, not a 1-based index (like /tasks/1)
    // Actually, if it's task_id it could coincidentally be a small number, but we can verify it matches the first task ID
    const currentUrl = studentPage.url();
    expect(currentUrl).toMatch(new RegExp(`/tasks/${taskIds[0]}/start$`));

    // Start the task
    await studentPage.locator('#start-btn').click();
    await studentPage.waitForSelector('problem-element', { timeout: 10000 });

    // 3. Teacher reorders tasks (Swapping 1st and 2nd tasks) via API
    const reorderedIds = [taskIds[1], taskIds[0], taskIds[2]].map(Number);
    const reorderResponse = await teacherPage.request.put(`/api/my_sets/${setId}/tasks`, {
      data: { task_ids: reorderedIds }
    });
    expect(reorderResponse.status()).toBe(200);

    // Verify teacher side reflects the change by reloading
    await teacherPage.reload();
    await teacherPage.waitForSelector('.task-set-item', { timeout: 10000 });
    const firstTaskTitle = await teacherPage.locator('.task-set-item').nth(0).locator('.task-set-title').innerText();
    expect(firstTaskTitle).toBe('greater_num');

    // 4. Student submits the task while the set order has changed
    // In the old system, this might 404 or submit to the wrong task if they reloaded, 
    // but with resilient URLs based on task_id, the submission will succeed.
    await submitTaskWrongThenCorrect(studentPage);

    // 5. Student goes back to task set overview and sees the new order
    await studentPage.goto(studentUrl + '/tasks');
    // Force a reload to bypass browser cache for the fetch request
    await studentPage.reload();
    await studentPage.waitForSelector('.task-set-item', { timeout: 10000 });
    
    // Note: nth(0) is the demo task "Hello, stranger!"
    const studentFirstTaskTitle = await studentPage.locator('.task-set-item').nth(1).locator('.task-set-title').innerText();
    expect(studentFirstTaskTitle.trim()).toBe('greater_num');
    
    const studentSecondTaskTitle = await studentPage.locator('.task-set-item').nth(2).locator('.task-set-title').innerText();
    expect(studentSecondTaskTitle.trim()).toBe('add_in_range');

    await teacherContext.close();
    await studentContext.close();
  });

  test('deactivated tasks show 404 error page for students', async ({ page, browser }) => {
    test.setTimeout(90000);
    const unique = Date.now();
    const shortUnique = unique.toString().slice(-8);
    const teacherUsername = `t_deact_${shortUnique}`;
    const teacherEmail = `t_deact_${shortUnique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Deactivation Test ${unique}`;

    // 1. Teacher Setup
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await loginTeacher(page, teacherEmail, teacherPassword);

    const originalTaskNames = ['hello_world', 'add_in_range'];
    await createTaskSetWithTasks(
      page,
      taskSetTitle,
      `Student description`,
      `Teacher description`,
      originalTaskNames
    );
    
    await page.goto('/teacher-dashboard');
    await page.waitForSelector('.task-set-title', { timeout: 10000 });
    const studentUrl = await getStudentUrl(page, taskSetTitle);

    // getStudentUrl already clicked taskSetTitle and navigated to task-set-overview
    const helloWorldItem = page.locator('.task-set-item', { hasText: 'hello_world' });
    const taskIdMatch = await helloWorldItem.getAttribute('data-task-id');

    // Click "Edit Tasks" to enter edit mode where Deactivate button is visible
    await page.locator('#edit-tasks-btn').click();

    // Deactivate 'hello_world'
    await helloWorldItem.locator('button.task-toggle-btn').click();
    await expect(helloWorldItem.locator('button.task-toggle-btn')).toHaveText(/Activate/);

    // Click "Done Editing"
    await page.locator('#edit-tasks-btn').click();

    // 2. Student Context
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    
    const studentUsername = `s_deact_${shortUnique}`;
    const studentEmail = `s_deact_${shortUnique}@example.com`;

    const regResp = await createTestStudent(studentPage, studentUsername, studentEmail);
    expect(regResp.ok()).toBeTruthy();
    
    await studentPage.goto(studentUrl);
    const urlParts = studentUrl.split('/set/');
    const uniqueLinkCode = urlParts.length > 1 ? urlParts[1].split('/')[0] : null;

    const loginResponsePromise = studentPage.waitForResponse(
      r => r.url().includes('/api/student_login')
    );
    await loginStudent(studentPage, studentEmail, 'password123', uniqueLinkCode);
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);

    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // 3. Student tries to visit the deactivated task URL
    const deactivatedTaskUrl = `${studentUrl}/tasks/${taskIdMatch}/start`;
    const response = await studentPage.goto(deactivatedTaskUrl);
    
    // Deactivated tasks return 410 (Gone) or 404 (Not Found)
    expect([404, 410]).toContain(response.status());
    
    // Ensure the not_found.html template is rendered
    const title = await studentPage.title();
    expect(title).toContain('Page Not Found');
    await expect(studentPage.locator('h1', { hasText: 'Page Not Found' })).toBeVisible();

    await studentContext.close();
  });
});
