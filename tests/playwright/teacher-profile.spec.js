// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  logoutTeacher,
} from './test-helpers.js';

test.describe('Teacher Profile Settings E2E', () => {
  test('teacher profile loads user details and allows updating email address', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `prof_teacher_${unique}`;
    const teacherEmail = `prof_teacher_${unique}@example.com`;
    const newEmail = `prof_teacher_${unique}_new@example.com`;
    const teacherPassword = 'password123';

    // 1. Register and login
    await registerTeacher(page, teacherUsername, teacherEmail, teacherPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, teacherPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 2. Navigate to profile page
    await page.goto('/teacher/profile');
    await expect(page).toHaveURL(/\/teacher\/profile$/);

    // 3. Verify profile info rendered
    await page.waitForSelector('#profile-username', { timeout: 10000 });
    await expect(page.locator('#profile-username')).toHaveText(teacherUsername);
    await expect(page.locator('#profile-email')).toHaveText(teacherEmail);

    // 4. Fill in Change Email form
    await page.locator('#new-email').fill(newEmail);
    await page.locator('#email-confirm-password').fill(teacherPassword);
    await page.locator('#change-email-form button[type="submit"]').click();

    // 5. Verify success alert and updated email display
    await page.waitForSelector('#email-alert-placeholder .alert-success', { timeout: 10000 });
    await expect(page.locator('#profile-email')).toHaveText(newEmail);
  });

  test('teacher can change password and log in with new credentials', async ({ page }) => {
    const unique = Date.now();
    const teacherUsername = `prof_pass_${unique}`;
    const teacherEmail = `prof_pass_${unique}@example.com`;
    const oldPassword = 'password123';
    const newPassword = 'newpassword123';

    // 1. Register and login
    await registerTeacher(page, teacherUsername, teacherEmail, oldPassword);
    await page.waitForSelector('#alert-placeholder .alert-success', { timeout: 10000 });
    await loginTeacher(page, teacherEmail, oldPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);

    // 2. Navigate to profile page
    await page.goto('/teacher/profile');
    await expect(page).toHaveURL(/\/teacher\/profile$/);

    // 3. Fill in Change Password form
    await page.locator('#current-password').fill(oldPassword);
    await page.locator('#new-password').fill(newPassword);
    await page.locator('#new-password-confirm').fill(newPassword);
    await page.locator('#change-password-form button[type="submit"]').click();

    // 4. Verify success alert
    await page.waitForSelector('#password-alert-placeholder .alert-success', { timeout: 10000 });

    // 5. Logout and login with new password
    await logoutTeacher(page);
    await loginTeacher(page, teacherEmail, newPassword);
    await expect(page).toHaveURL(/\/teacher-dashboard$/);
  });
});
