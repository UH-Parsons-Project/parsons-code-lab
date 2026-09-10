// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTestStudent,
} from './test-helpers.js';

test.describe('Admin User Details Inspection Views E2E', () => {
  test('admin can open and view teacher details page (admins-teacher-view)', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `view_teacher_${unique}`;
    const teacherEmail = `view_teacher_${unique}@example.com`;
    const teacherPassword = 'password123';

    // 1. Register a teacher user
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });

    // 2. Login as admin teacher
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 3. Navigate to /all-users
    await page.goto('/all-users');
    await page.waitForSelector('#teachers-container .task-set-item', { timeout: 15000 });

    // 4. Search for teacher and click card
    const teacherSearch = page.locator('#teacher-search');
    await expect(teacherSearch).toBeVisible({ timeout: 10000 });
    await teacherSearch.fill(teacherUsername);
    const teacherCard = page.locator('#teachers-container .task-set-item', { hasText: teacherUsername });
    await expect(teacherCard).toBeVisible({ timeout: 10000 });
    await teacherCard.click();

    // 5. Verify navigation to /admin/admins-teacher-view?teacher_id=...
    await page.waitForURL(/\/admin\/admins-teacher-view\?teacher_id=\d+/, { timeout: 15000 });
    await page.waitForSelector('#overview-username', { timeout: 10000 });

    // 6. Verify overview elements
    await expect(page.locator('#page-title')).toContainText('Teacher Profile');
    await expect(page.locator('#overview-username')).toHaveText(teacherUsername);
    await expect(page.locator('#overview-email')).toHaveText(teacherEmail);
    await expect(page.locator('#overview-sets-count')).toBeVisible();
    await expect(page.locator('#overview-tasks-count')).toBeVisible();

    // 7. Verify back button returns to /all-users
    const backBtn = page.locator('a', { hasText: 'Back to Users' });
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await page.waitForURL(/\/all-users$/, { timeout: 10000 });
  });

  test('admin can open and view student details page (admins-student-view)', async ({ page }) => {
    const unique = Date.now() % 1000000;
    const studentUsername = `view_student_${unique}`;
    const studentEmail = `view_student_${unique}@example.com`;

    // 1. Create a student user
    await createTestStudent(page, studentUsername, studentEmail, 'password123');

    // 2. Login as admin teacher
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 3. Navigate to /all-users
    await page.goto('/all-users');
    await page.waitForSelector('#students-container .task-set-item', { timeout: 15000 });

    // 4. Search for student and click card
    await page.locator('#student-search').fill(studentUsername);
    const studentCard = page.locator('#students-container .task-set-item', { hasText: studentUsername });
    await expect(studentCard).toBeVisible({ timeout: 10000 });
    await studentCard.click();

    // 5. Verify navigation to /admin/admins-student-view?student_id=...
    await page.waitForURL(/\/admin\/admins-student-view\?student_id=\d+/, { timeout: 15000 });
    await page.waitForSelector('#overview-username', { timeout: 10000 });

    // 6. Verify overview elements
    await expect(page.locator('#page-title')).toContainText('Student Profile');
    await expect(page.locator('#overview-username')).toHaveText(studentUsername);
    await expect(page.locator('#overview-email')).toHaveText(studentEmail);
    await expect(page.locator('#overview-sets-count')).toBeVisible();
    await expect(page.locator('#overview-tasks-count')).toBeVisible();

    // 7. Verify back button returns to /all-users
    const backBtn = page.locator('a', { hasText: 'Back to Users' });
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await page.waitForURL(/\/all-users$/, { timeout: 10000 });
  });
});
