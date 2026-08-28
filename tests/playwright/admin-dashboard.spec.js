// @ts-check
import { test, expect } from '@playwright/test';
import { loginTeacher, createTestStudent } from './test-helpers.js';

test.beforeEach(async ({ page }) => {
  // Login as seeded admin user
  await loginTeacher(page, 'mattiruotsalainen', 'test1234');
  await expect(page).toHaveURL(/\/teacher-dashboard$/);

  // Register one student so "Registered Students" stat is non-zero
  const unique = Date.now() % 1000000;
  const studentUsername = `student_${unique}`;
  const studentEmail = `student_${unique}@example.com`;
  const resp = await createTestStudent(page, studentUsername, studentEmail, 'password123');
  if (!resp.ok()) {
    console.warn('Student registration in beforeEach returned', resp.status());
  }
});

test('admin dashboard shows stats and can create a registration token', async ({ page }) => {

  // Open admin dashboard
  await page.goto('/admin-dashboard');

  // Basic stats elements should be visible
  await page.waitForSelector('#stat-registered-students', { timeout: 10000 });
  await expect(page.locator('#stat-registered-students')).toBeVisible();
  // Registered teachers stat should be visible as well
  await page.waitForSelector('#stat-registered-teachers', { timeout: 10000 });
  await expect(page.locator('#stat-registered-teachers')).toBeVisible();
  await expect(page.locator('#stat-total-lists')).toBeVisible();

  // Token management UI should be present
  await expect(page.locator('#generate-token-btn')).toBeVisible();
  await expect(page.locator('#add-token-btn')).toBeVisible();
  await expect(page.locator('#token-input')).toBeVisible();

  // Generate a token and ensure input receives a value
  await page.locator('#generate-token-btn').click();
  const generated = await page.locator('#token-input').inputValue();
  expect(generated.length).toBeGreaterThan(0);

  // Add the token and verify the token display appears with a value
  await Promise.all([
    page.waitForSelector('#token-display', { timeout: 10000 }),
    page.locator('#add-token-btn').click(),
  ]);

  await expect(page.locator('#token-value')).toBeVisible();
  const displayed = (await page.locator('#token-value').textContent()) || '';
  expect(displayed.trim().length).toBeGreaterThan(0);

  // Tokens list should contain at least one token entry after creation
  await page.waitForSelector('#tokens-list .token-item', { timeout: 10000 });
  const tokenItems = await page.locator('#tokens-list .token-item').count();
  expect(tokenItems).toBeGreaterThan(0);

  // Verify admin dashboard shows counts: registered students, registered teachers and total task sets
  const studentsText = (await page.locator('#stat-registered-students').textContent()) || '';
  const teachersText = (await page.locator('#stat-registered-teachers').textContent()) || '';
  const listsText = (await page.locator('#stat-total-lists').textContent()) || '';

  /** @param {string} s */
  const parseNumber = (s) => {
    const m = s.replace(/[^0-9]/g, '');
    return m ? parseInt(m, 10) : 0;
  };

  expect(parseNumber(studentsText)).toBeGreaterThan(0);
  expect(parseNumber(teachersText)).toBeGreaterThan(0);
  expect(parseNumber(listsText)).toBeGreaterThan(0);
});

test('admin can view and add task type tags', async ({ page }) => {
  await page.goto('/admin-dashboard');
  await page.waitForSelector('#task-types-list .task-tag-chip', { timeout: 10000 });

  await expect(page.locator('#task-tags-title')).toHaveText('Task tags');
  await expect(page.locator('.task-tags-description')).toHaveText('Add and view tags teachers can assign to tasks.');
  await expect(page.locator('.task-tags-group-title')).toHaveText('Existing tags');
  await expect(page.locator('.task-tags-table')).toHaveCount(0);
  await expect(page.getByText('Used in tasks', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Status', { exact: true })).toHaveCount(0);
  await expect(page.locator('.task-tag-menu-button')).toHaveCount(0);

  const inactiveTags = page.locator('#inactive-task-tags');
  await expect(inactiveTags).toBeVisible();
  await expect(inactiveTags).not.toHaveAttribute('open', '');
  const inactiveSummary = inactiveTags.locator('summary');
  await expect(inactiveSummary).toHaveText(/Inactive tags \(\d+\)/);
  await inactiveSummary.click();
  await expect(inactiveTags).toHaveAttribute('open', '');
  await expect(inactiveTags.locator('.task-tag-chip--inactive').first()).toBeVisible();

  const unique = Date.now();
  const label = `E2E Task Tag ${unique}`;

  await page.getByRole('button', { name: '+ Add tag' }).click();
  await expect(page.getByRole('dialog', { name: 'Add tag' })).toBeVisible();
  await page.locator('#task-tag-name').fill(label);
  await page.getByRole('button', { name: 'Add tag', exact: true }).last().click();

  const chip = page.locator('.task-tag-chip').filter({ hasText: label });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('button')).toHaveCount(0);
  await expect(page.locator('#task-tag-modal')).toBeHidden();
});
