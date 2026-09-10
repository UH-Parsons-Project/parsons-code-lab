// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  logoutTeacher,
  createTestStudent,
} from './test-helpers.js';

test.describe('Admin User Management E2E', () => {
  test('admin can reset user password from all-users UI', async ({ page }) => {
    const unique = Date.now() % 1000000;
    const studentUsername = `st_reset_${unique}`;
    const studentEmail = `st_reset_${unique}@example.com`;
    const oldPassword = 'password123';

    // 1. Create a test student
    await createTestStudent(page, studentUsername, studentEmail, oldPassword);

    // 2. Login as admin teacher
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 3. Navigate to /all-users page
    await page.goto('/all-users');
    await page.waitForSelector('#students-container .task-set-item', { timeout: 15000 });

    // 4. Search for student
    await page.locator('#student-search').fill(studentUsername);
    const studentCard = page.locator('#students-container .task-set-item', { hasText: studentUsername });
    await expect(studentCard).toBeVisible({ timeout: 10000 });

    // 5. Click Reset Password button on student card
    const resetBtn = studentCard.locator('button', { hasText: 'Reset Password' });
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // 6. Confirm password reset in modal with admin password
    const modal = page.locator('.admin-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.locator('input[type="password"]').fill('test1234');
    await modal.locator('.confirm-btn').click();

    // 7. Verify Reset Result modal appears with temporary password
    const resultModal = page.locator('.admin-modal-overlay');
    await expect(resultModal.locator('h5')).toContainText('Password Reset Successful');
    const newPasswordInput = resultModal.locator('.admin-password-input');
    await expect(newPasswordInput).toBeVisible();
    const newPassword = await newPasswordInput.inputValue();
    expect(newPassword.length).toBeGreaterThan(0);
    expect(newPassword).not.toBe(oldPassword);

    // Close result modal
    await resultModal.locator('.close-btn').click();
  });

  test('admin can promote a teacher to admin status from all-users UI', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `std_teacher_${unique}`;
    const teacherEmail = `std_teacher_${unique}@example.com`;
    const teacherPassword = 'password123';

    // 1. Register a standard teacher
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

    // 2. Login as admin teacher
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 3. Navigate to /all-users
    await page.goto('/all-users');
    await page.waitForSelector('#teachers-container .task-set-item', { timeout: 15000 });

    // 4. Search for the standard teacher
    const teacherSearch = page.locator('#teacher-search');
    await expect(teacherSearch).toBeVisible({ timeout: 10000 });
    await teacherSearch.fill(teacherUsername);
    const teacherCard = page.locator('#teachers-container .task-set-item', { hasText: teacherUsername });
    await expect(teacherCard).toBeVisible({ timeout: 10000 });

    // 5. Click Make Admin button
    const makeAdminBtn = teacherCard.locator('button', { hasText: 'Make Admin' });
    await expect(makeAdminBtn).toBeVisible();
    await makeAdminBtn.click();

    // 6. Confirm in modal with admin password
    const modal = page.locator('.admin-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.locator('input[type="password"]').fill('test1234');
    await modal.locator('.confirm-btn').click();

    // 7. Verify teacher card is re-rendered with the Admin badge
    const updatedCard = page.locator('#teachers-container .task-set-item', { hasText: teacherUsername });
    await expect(updatedCard.locator('.task-set-code-chip', { hasText: 'Admin' })).toBeVisible({ timeout: 10000 });
    await expect(updatedCard.locator('button', { hasText: 'Make Admin' })).toHaveCount(0);

    // 8. Logout admin and verify promoted teacher can access /admin-dashboard
    await logoutTeacher(page);
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    await page.goto('/admin-dashboard');
    await expect(page).toHaveURL(/\/admin-dashboard$/);
  });

  test('admin can delete a student user from all-users UI', async ({ page }) => {
    const unique = Date.now() % 1000000;
    const studentUsername = `st_del_${unique}`;
    const studentEmail = `st_del_${unique}@example.com`;

    // 1. Create student user
    await createTestStudent(page, studentUsername, studentEmail, 'password123');

    // 2. Login as admin teacher
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 3. Navigate to /all-users
    await page.goto('/all-users');
    await page.waitForSelector('#students-container .task-set-item', { timeout: 15000 });

    // 4. Search for student
    await page.locator('#student-search').fill(studentUsername);
    const studentCard = page.locator('#students-container .task-set-item', { hasText: studentUsername });
    await expect(studentCard).toBeVisible({ timeout: 10000 });

    // 5. Click Delete button
    const deleteBtn = studentCard.locator('button', { hasText: 'Delete' });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 6. Confirm in modal with admin password
    const modal = page.locator('.admin-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.locator('input[type="password"]').fill('test1234');
    await modal.locator('.confirm-btn').click();

    // 7. Verify student card is removed from DOM
    await expect(page.locator('#students-container .task-set-item', { hasText: studentUsername })).toHaveCount(0, { timeout: 10000 });
  });

  test('admin can delete teacher from all-users UI and verify public tasks are reassigned to deleted_user', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `del_teacher_${unique}`;
    const teacherEmail = `del_teacher_${unique}@example.com`;
    const teacherPassword = 'password123';
    const customTaskTitle = `PubTask_${unique}`;

    // 1. Register teacher and log in
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // Create a public task created by this teacher using POST /api/problems
    const createResp = await page.evaluate(async (taskTitle) => {
      const res = await fetch('/api/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          taskTitle: taskTitle,
          description: 'Task by teacher to be deleted',
          startDescription: 'Start intro',
          tests: 'assert test_reassign() == 1',
          solutionCode: 'def test_reassign():\n    return 1',
          parsonsRepr: 'def test_reassign(): #0given\n    return 1 #1given',
          is_public: true,
          task_type: 'normal',
          modelAnswerCode: 'def test_reassign():\n    return 1'
        })
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    }, customTaskTitle);

    if (!createResp.ok) {
      console.error('Failed to create problem:', createResp);
    }
    expect(createResp.ok).toBe(true);

    // 2. Logout target teacher and login as admin teacher
    await logoutTeacher(page);
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 3. Navigate to /all-users
    await page.goto('/all-users');
    await page.waitForSelector('#teachers-container .task-set-item', { timeout: 15000 });

    // 4. Search for target teacher
    const teacherSearch = page.locator('#teacher-search');
    await expect(teacherSearch).toBeVisible({ timeout: 10000 });
    await teacherSearch.fill(teacherUsername);
    const teacherCard = page.locator('#teachers-container .task-set-item', { hasText: teacherUsername });
    await expect(teacherCard).toBeVisible({ timeout: 10000 });

    // 5. Click Delete button
    const deleteBtn = teacherCard.locator('button', { hasText: 'Delete' });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 6. Confirm deletion in modal with admin password
    const modal = page.locator('.admin-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.locator('input[type="password"]').fill('test1234');
    await modal.locator('.confirm-btn').click();

    // 7. Verify target teacher card is removed from /all-users
    await expect(page.locator('#teachers-container .task-set-item', { hasText: teacherUsername })).toHaveCount(0, { timeout: 10000 });

    // 8. Go to /global-statistics and verify public task is reassigned to deleted_user
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    // Search for created task
    await page.locator('#task-filter-toggle').click();
    await page.locator('#task-search').fill(customTaskTitle);

    const reassignedTaskCard = page.locator('#problems-list .task-set-item', { hasText: customTaskTitle });
    await expect(reassignedTaskCard.first()).toBeVisible({ timeout: 10000 });
    await expect(reassignedTaskCard.first().locator('.task-set-meta')).toContainText('Teacher deleted_user');
  });
});
