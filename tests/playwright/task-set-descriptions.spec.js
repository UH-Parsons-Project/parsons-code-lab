// @ts-check
import { test, expect } from '@playwright/test';
import {
  registerTeacher,
  loginTeacher,
  createTaskSetWithTasks,
} from './test-helpers.js';

test.describe('Task Set Overview descriptions', () => {
  test('teacher can edit and persist Teacher Notes and Student Instructions', async ({ page }) => {
    test.setTimeout(60000);

    const unique = Date.now();
    const username = `teacher_desc_${unique}`;
    const email = `teacher_desc_${unique}@example.com`;
    const password = 'password123';
    const taskSetTitle = `Description Editing ${unique}`;
    const initialStudentInstructions = `Initial student instructions ${unique}`;
    const initialTeacherNotes = `Initial teacher notes ${unique}`;
    const updatedStudentInstructions = `Updated student instructions ${unique}`;
    const updatedTeacherNotes = `Updated teacher notes ${unique}`;

    await registerTeacher(page, username, email, password);
    await expect(page.locator('#alert-placeholder .alert-success')).toBeVisible();
    await loginTeacher(page, email, password);

    await createTaskSetWithTasks(
      page,
      taskSetTitle,
      initialStudentInstructions,
      initialTeacherNotes,
      ['add_in_range']
    );

    await page.locator('.task-set-title', { hasText: taskSetTitle }).click();
    await page.waitForURL(/\/task-set-overview/);
    await page.locator('#content-container').waitFor({ state: 'visible' });

    const studentBox = page.locator('#student_description-description-box');
    const teacherBox = page.locator('#teacher_description-description-box');

    await expect(studentBox).toContainText(initialStudentInstructions);
    await expect(teacherBox).toContainText(initialTeacherNotes);

    await studentBox.locator('[data-description-field="student_description"]').click();
    await studentBox.locator('#student_description-input').fill(updatedStudentInstructions);
    await studentBox.locator('[data-description-save="student_description"]').click();
    await expect(studentBox).toContainText(updatedStudentInstructions);

    await teacherBox.locator('[data-description-field="teacher_description"]').click();
    await teacherBox.locator('#teacher_description-input').fill(updatedTeacherNotes);
    await teacherBox.locator('[data-description-save="teacher_description"]').click();
    await expect(teacherBox).toContainText(updatedTeacherNotes);

    await page.reload();
    await page.locator('#content-container').waitFor({ state: 'visible' });

    await expect(page.locator('#student_description-description-box'))
      .toContainText(updatedStudentInstructions);
    await expect(page.locator('#teacher_description-description-box'))
      .toContainText(updatedTeacherNotes);
  });
});