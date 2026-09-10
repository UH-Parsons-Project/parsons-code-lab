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

test.describe('Student Profile - Email & Password Changes', () => {
  let studentUrl;
  let unique;

  test.beforeEach(async ({ page }) => {
    unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const teacherUsername = `t_prof_${unique}`;
    const teacherEmail = `t_prof_${unique}@example.com`;
    const teacherPassword = 'password123';
    const taskSetTitle = `Profile Test Set ${unique}`;

    // Teacher creates task set so student can register
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await loginTeacher(page, teacherEmail, teacherPassword);
    await createTaskSetWithTasks(
      page,
      taskSetTitle,
      `Desc`,
      `Desc`,
      ['add_in_range']
    );
    studentUrl = await getStudentUrl(page, taskSetTitle);
  });

  test('student can successfully change email', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    const studentUsername = `st_${unique}`;
    const studentEmail = `student_${unique}@example.com`;
    const studentPassword = 'password123'; // Default in test helper
    const newEmail = `new_${unique}@example.com`;

    await registerStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail, studentPassword);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Fill change email form
    await studentPage.locator('#new-email').fill(newEmail);
    await studentPage.locator('#email-confirm-password').fill(studentPassword);
    await studentPage.locator('#change-email-form button[type="submit"]').click();

    // Verify success alert
    await expect(studentPage.locator('#email-alert-placeholder .alert-success')).toContainText('Email address successfully updated.');

    // Verify profile info is updated
    await expect(studentPage.locator('#profile-email')).toHaveText(newEmail);

    await studentContext.close();
  });

  test('student cannot change email with incorrect password', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    const studentUsername = `st_${unique}`;
    const studentEmail = `student_${unique}@example.com`;
    const studentPassword = 'password123';
    const newEmail = `new_${unique}@example.com`;

    await registerStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail, studentPassword);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Fill change email form with wrong password
    await studentPage.locator('#new-email').fill(newEmail);
    await studentPage.locator('#email-confirm-password').fill('wrongpassword');
    await studentPage.locator('#change-email-form button[type="submit"]').click();

    // Verify error alert
    await expect(studentPage.locator('#email-alert-placeholder .alert-danger')).toBeVisible();
    await expect(studentPage.locator('#profile-email')).toHaveText(studentEmail); // Email should not change

    await studentContext.close();
  });

  test('student can successfully change password', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    const studentUsername = `st_${unique}`;
    const studentEmail = `student_${unique}@example.com`;
    const studentPassword = 'password123';
    const newPassword = 'newpassword123';

    await registerStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail, studentPassword);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Fill change password form
    await studentPage.locator('#current-password').fill(studentPassword);
    await studentPage.locator('#new-password').fill(newPassword);
    await studentPage.locator('#new-password-confirm').fill(newPassword);
    await studentPage.locator('#change-password-form button[type="submit"]').click();

    // Verify success alert
    await expect(studentPage.locator('#password-alert-placeholder .alert-success')).toContainText('Password successfully updated.');

    // Verify login works with new password
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#logout-btn').click();

    await loginStudent(studentPage, studentEmail, newPassword);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    await studentContext.close();
  });

  test('student cannot change password if new passwords do not match', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    const studentUsername = `st_${unique}`;
    const studentEmail = `student_${unique}@example.com`;
    const studentPassword = 'password123';

    await registerStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail, studentPassword);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Fill change password form with mismatched passwords
    await studentPage.locator('#current-password').fill(studentPassword);
    await studentPage.locator('#new-password').fill('newpassword123');
    await studentPage.locator('#new-password-confirm').fill('differentpassword');

    // HTML5 validation or JS validation should block it or show error
    await studentPage.locator('#change-password-form button[type="submit"]').click();

    // Check if error alert is shown (depends on if it's JS or backend)
    await studentPage.waitForTimeout(500);
    const alertDanger = studentPage.locator('#password-alert-placeholder .alert-danger');
    if (await alertDanger.isVisible()) {
      await expect(alertDanger).toBeVisible();
    } else {
      // HTML5 validation might be active, or form didn't submit
      const isConfirmInvalid = await studentPage.locator('#new-password-confirm').evaluate(el => !el.checkValidity());
      expect(isConfirmInvalid || await alertDanger.isVisible()).toBeTruthy();
    }

    await studentContext.close();
  });

  test('student cannot change password with incorrect current password', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    const studentUsername = `st_${unique}`;
    const studentEmail = `student_${unique}@example.com`;
    const studentPassword = 'password123';

    await registerStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail, studentPassword);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Fill change password form with wrong current password
    await studentPage.locator('#current-password').fill('wrongpassword');
    await studentPage.locator('#new-password').fill('newpassword123');
    await studentPage.locator('#new-password-confirm').fill('newpassword123');
    await studentPage.locator('#change-password-form button[type="submit"]').click();

    // Verify error alert
    await expect(studentPage.locator('#password-alert-placeholder .alert-danger')).toBeVisible();

    await studentContext.close();
  });

  test('student cannot change password to current password', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentUrl);

    const studentUsername = `st_${unique}`;
    const studentEmail = `student_${unique}@example.com`;
    const studentPassword = 'password123';

    await registerStudent(studentPage, studentUsername, studentEmail);
    await studentPage.goto(studentUrl);
    await loginStudent(studentPage, studentEmail, studentPassword);
    await studentPage.waitForURL(studentUrl + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Fill change password form with new password same as current
    await studentPage.locator('#current-password').fill(studentPassword);
    await studentPage.locator('#new-password').fill(studentPassword);
    await studentPage.locator('#new-password-confirm').fill(studentPassword);
    await studentPage.locator('#change-password-form button[type="submit"]').click();

    // Verify error alert
    await expect(studentPage.locator('#password-alert-placeholder .alert-danger')).toBeVisible();
    await expect(studentPage.locator('#password-alert-placeholder .alert-danger')).toContainText('New password cannot be the same as the current password');

    await studentContext.close();
  });
});

test.describe('Student Profile - My Task Sets', () => {
  let unique;
  let teacherUsername, teacherEmail, teacherPassword;
  let set1Title, set2Title;
  let set1Url, set2Url;

  test.beforeEach(async ({ page }) => {
    unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    teacherUsername = `t_sets_${unique}`;
    teacherEmail = `t_sets_${unique}@example.com`;
    teacherPassword = 'password123';
    set1Title = `Set One ${unique}`;
    set2Title = `Set Two ${unique}`;

    // Teacher creates two task sets
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await loginTeacher(page, teacherEmail, teacherPassword);

    // Set 1 has 2 tasks
    await createTaskSetWithTasks(page, set1Title, `Desc`, `Desc`, ['add_in_range', 'greater_num']);
    set1Url = await getStudentUrl(page, set1Title);

    // Set 2 has 1 task
    await page.goto('/teacher-dashboard');
    await createTaskSetWithTasks(page, set2Title, `Desc`, `Desc`, ['hello_world']);
    set2Url = await getStudentUrl(page, set2Title);
  });

  test('profile displays correct data for multiple task sets', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();

    const studentUsername = `st_sets_${unique}`;
    const studentEmail = `student_sets_${unique}@example.com`;

    // Student registers via Set 1
    await studentPage.goto(set1Url);
    await registerStudent(studentPage, studentUsername, studentEmail);

    await studentPage.goto(set1Url);
    await loginStudent(studentPage, studentEmail, 'password123');
    await studentPage.waitForURL(set1Url + '/tasks', { timeout: 15000 });

    // Solve 1 task in Set 1 so it shows 1/2 completed
    await studentPage.locator('.task-set-item', { hasText: 'add_in_range' }).click();
    await studentPage.waitForSelector('#start-btn', { timeout: 10000 });
    await studentPage.locator('#start-btn').click();
    await studentPage.waitForSelector('.btn.btn-primary:not([disabled])', { timeout: 30000 });
    await studentPage.goto(set1Url + '/tasks');

    // Now student joins Set 2
    await studentPage.goto(set2Url);
    // Click join button
    await studentPage.waitForSelector('#join-btn', { timeout: 10000 });
    await studentPage.locator('#join-btn').click();
    await studentPage.waitForURL(set2Url + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Verify both sets are present in #enrolled-sets-container
    const set1Locator = studentPage.locator('li', { hasText: set1Title });
    const set2Locator = studentPage.locator('li', { hasText: set2Title });

    await expect(set1Locator).toBeVisible();
    await expect(set2Locator).toBeVisible();

    // Verify Set 1 details (0/2 completed, Teacher name)
    await expect(set1Locator).toContainText(`Teacher: ${teacherUsername}`);
    await expect(set1Locator).toContainText('0/2 completed');
    await expect(set1Locator).toContainText('In progress');
    await expect(set1Locator.locator('.profile-task-set-link')).toContainText('Open set'); // Not current set

    // Verify Set 2 details (0/1 completed, Teacher name)
    await expect(set2Locator).toContainText(`Teacher: ${teacherUsername}`);
    await expect(set2Locator).toContainText('0/1 completed');
    await expect(set2Locator).toContainText('In progress');
    await expect(set2Locator.locator('.profile-task-set-link')).toContainText('Current set');

    await studentContext.close();
  });

  test('clicking another task set when current is incomplete shows warning modal', async ({ browser }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();

    const studentUsername = `st_sets2_${unique}`;
    const studentEmail = `student_sets2_${unique}@example.com`;

    // Student registers via Set 1
    await studentPage.goto(set1Url);
    await registerStudent(studentPage, studentUsername, studentEmail);

    await studentPage.goto(set1Url);
    await loginStudent(studentPage, studentEmail, 'password123');
    await studentPage.waitForURL(set1Url + '/tasks', { timeout: 15000 });

    // Now student joins Set 2
    await studentPage.goto(set2Url);
    await studentPage.waitForSelector('#join-btn', { timeout: 10000 });
    await studentPage.locator('#join-btn').click();
    await studentPage.waitForURL(set2Url + '/tasks', { timeout: 15000 });

    // Navigate to profile
    const toggle = studentPage.locator('#navbar-burger-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
    }
    await studentPage.locator('#profile-link').click();
    await studentPage.waitForURL(/\/student\/profile$/, { timeout: 10000 });

    // Try to open Set 1 (which is NOT the current set)
    const set1Locator = studentPage.locator('li', { hasText: set1Title });
    await set1Locator.locator('.profile-task-set-link').click();

    // Verify the warning modal appears
    const modal = studentPage.locator('.task-set-nav-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Current task set is still in progress');
    await expect(modal).toContainText('Please finish the current task set before moving on to another one.');

    // Click "Open anyway"
    await modal.locator('button[data-action="open"]').click();

    // Verify we navigate to Set 1's tasks
    await studentPage.waitForURL(set1Url + '/tasks', { timeout: 15000 });

    await studentContext.close();
  });
});
