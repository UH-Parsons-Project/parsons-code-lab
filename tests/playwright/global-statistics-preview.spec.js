// @ts-check
import { test, expect } from '@playwright/test';
import { loginTeacher } from './test-helpers.js';

test.describe('Task Database Browser & Quick Preview E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Login as default seeded test teacher
    await loginTeacher(page, 'matti.ruotsalainen@example.com', 'test1234');
    await expect(page).toHaveURL(/\/teacher-dashboard$/);
  });

  test('displays split-pane layout with task list and sticky preview panel placeholder', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    // Verify main two-column container elements
    await expect(page.locator('.gs-layout')).toBeVisible();
    await expect(page.locator('.gs-list-col')).toBeVisible();
    await expect(page.locator('.gs-preview-col')).toBeVisible();

    // Verify initial empty placeholder state in right panel
    const emptyState = page.locator('#task-preview-panel .preview-empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('Hover over a task to see a quick overview');
  });

  test('task list cards feature creation date next to title, popping type badge, and borderless star button', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const firstCard = page.locator('#problems-list .task-set-item').first();
    await expect(firstCard).toBeVisible();

    // 1. Verify date appears next to title inside top wrapper
    const dateSpan = firstCard.locator('.task-card-date');
    await expect(dateSpan).toBeVisible();

    // 2. Verify popping task type badge exists (.type-faded or .type-normal)
    const typeBadge = firstCard.locator('.task-type-badge');
    await expect(typeBadge).toBeVisible();

    // 3. Verify favorite star button has no rectangular border
    const starBtn = firstCard.locator('.task-favorite-button');
    await expect(starBtn).toBeVisible();
    const borderVal = await starBtn.evaluate(el => getComputedStyle(el).borderStyle);
    expect(['none', 'hidden', '']).toContain(borderVal);
  });

  test('hovering a task card renders quick preview with side-by-side blocks and model answer', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const firstCard = page.locator('#problems-list .task-set-item').first();

    // Hover over the first task card to trigger hover preview
    await firstCard.hover();

    // Wait for preview card to populate in right panel
    const previewCard = page.locator('#task-preview-panel .task-preview-card');
    await expect(previewCard).toBeVisible({ timeout: 10000 });

    // Verify preview title header contains inline date
    const previewTitle = previewCard.locator('.preview-title');
    await expect(previewTitle).toBeVisible();
    await expect(previewTitle.locator('.task-card-date')).toBeVisible();

    // Verify side-by-side grid container
    const grid = previewCard.locator('.preview-blocks-model-grid');
    await expect(grid).toBeVisible({ timeout: 10000 });

    // Verify Code Blocks list is visible
    const blocksList = grid.locator('.preview-blocks-list');
    await expect(blocksList).toBeVisible();

    // Verify Model Answer container is visible
    const modelCode = grid.locator('.preview-model-code');
    await expect(modelCode).toBeVisible();
  });

  test('toggling favorite star updates both card and preview panel', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const firstCard = page.locator('#problems-list .task-set-item').first();
    await firstCard.hover();

    await page.waitForSelector('#task-preview-panel .task-preview-card', { timeout: 10000 });

    const cardStar = firstCard.locator('.task-favorite-button');
    const wasFavorite = await cardStar.evaluate(el => el.classList.contains('is-favorite'));

    // Click favorite star on card
    await cardStar.click();

    // Verify favorite class toggles on card star and preview star using auto-retrying assertions
    const previewStar = page.locator('#preview-fav-btn');
    const updatedCardStar = page.locator('#problems-list .task-set-item').first().locator('.task-favorite-button');
    if (wasFavorite) {
      await expect(updatedCardStar).not.toHaveClass(/is-favorite/);
      await expect(previewStar).not.toHaveClass(/is-favorite/);
    } else {
      await expect(updatedCardStar).toHaveClass(/is-favorite/);
      await expect(previewStar).toHaveClass(/is-favorite/);
    }
  });

  test('clicking favorite star in preview panel updates card and preview panel', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const firstCard = page.locator('#problems-list .task-set-item').first();
    await firstCard.hover();

    await page.waitForSelector('#task-preview-panel .task-preview-card', { timeout: 10000 });

    const previewStar = page.locator('#preview-fav-btn');
    await expect(previewStar).toBeVisible();

    const wasFavorite = await previewStar.evaluate(el => el.classList.contains('is-favorite'));

    // Click favorite star inside preview panel
    await previewStar.click();

    // Verify favorite class toggles on both preview star and card star
    if (wasFavorite) {
      await expect(previewStar).not.toHaveClass(/is-favorite/);
      await expect(firstCard.locator('.task-favorite-button')).not.toHaveClass(/is-favorite/);
    } else {
      await expect(previewStar).toHaveClass(/is-favorite/);
      await expect(firstCard.locator('.task-favorite-button')).toHaveClass(/is-favorite/);
    }
  });

  test('preview card provides correct links for full details and solve task', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const firstCard = page.locator('#problems-list .task-set-item').first();
    await firstCard.hover();

    const previewCard = page.locator('#task-preview-panel .task-preview-card');
    await expect(previewCard).toBeVisible({ timeout: 10000 });

    // Verify Full Details link exists and points to /task-details?id=
    const fullDetailsLink = previewCard.locator('a', { hasText: 'Full Details' });
    await expect(fullDetailsLink).toBeVisible();
    await expect(fullDetailsLink).toHaveAttribute('href', /\/task-details\?id=/);

    // Verify Solve Task link exists and points to /task?id=
    const solveTaskLink = previewCard.locator('a', { hasText: 'Solve Task' });
    await expect(solveTaskLink).toBeVisible();
    await expect(solveTaskLink).toHaveAttribute('href', /\/task\?id=/);
    await expect(solveTaskLink).toHaveAttribute('target', '_blank');

    // Extract href and navigate directly to verify page loads without 404
    const href = await solveTaskLink.getAttribute('href');
    await page.goto(href);
    await expect(page.locator('#user-name')).toHaveText('PREVIEW');
    await expect(page.locator('#problem-wrapper')).toBeVisible();
  });


  test('hovering different task cards dynamically updates preview panel', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const cards = page.locator('#problems-list .task-set-item');
    const cardCount = await cards.count();
    if (cardCount >= 2) {
      const firstCard = cards.nth(0);
      const secondCard = cards.nth(1);

      // Get titles of both cards
      const firstTitleText = (await firstCard.locator('.task-set-title').innerText()).trim();
      const secondTitleText = (await secondCard.locator('.task-set-title').innerText()).trim();

      // Hover first card
      await firstCard.hover();
      await page.waitForSelector('#task-preview-panel .task-preview-card', { timeout: 10000 });
      await expect(page.locator('#task-preview-panel .preview-title')).toContainText(firstTitleText);

      // Hover second card
      await secondCard.hover();
      await page.waitForTimeout(200); // allow hover timer (120ms) to trigger
      await expect(page.locator('#task-preview-panel .preview-title')).toContainText(secondTitleText);
    }
  });

  test('clicking Solve Task button on a task list card opens solver page in a new tab', async ({ page, context }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const firstCard = page.locator('#problems-list .task-set-item').first();
    const solveBtn = firstCard.locator('a', { hasText: 'Solve Task' });

    await expect(solveBtn).toBeVisible();
    await expect(solveBtn).toHaveAttribute('href', /\/task\?id=/);
    await expect(solveBtn).toHaveAttribute('target', '_blank');

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      solveBtn.click(),
    ]);

    await newPage.waitForLoadState();
    await expect(newPage.locator('#problem-wrapper')).toBeVisible({ timeout: 10000 });
  });

  test('clicking Solve Task button inside preview panel opens solver page in a new tab', async ({ page, context }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const firstCard = page.locator('#problems-list .task-set-item').first();
    await firstCard.hover();

    const previewCard = page.locator('#task-preview-panel .task-preview-card');
    await expect(previewCard).toBeVisible({ timeout: 10000 });

    const solveTaskBtn = previewCard.locator('a', { hasText: 'Solve Task' });
    await expect(solveTaskBtn).toBeVisible();
    await expect(solveTaskBtn).toHaveAttribute('href', /\/task\?id=/);
    await expect(solveTaskBtn).toHaveAttribute('target', '_blank');

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      solveTaskBtn.click(),
    ]);

    await newPage.waitForLoadState();
    await expect(newPage.locator('#problem-wrapper')).toBeVisible({ timeout: 10000 });
  });

  test('toggles search and filter panel', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const toggleBtn = page.locator('#task-filter-toggle');
    const filterPanel = page.locator('#task-filter-panel');

    await expect(filterPanel).not.toHaveClass(/show/);

    await toggleBtn.click();
    await expect(filterPanel).toHaveClass(/show/);
    await expect(page.locator('#task-search')).toBeVisible();

    await toggleBtn.click();
    await expect(filterPanel).not.toHaveClass(/show/);
  });

  test('filters tasks by search query and updates task count badge', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    const taskBadge = page.locator('#task-count-badge');
    await expect(taskBadge).toBeVisible();
    const initialBadgeText = await taskBadge.innerText();

    // Open filter panel
    await page.locator('#task-filter-toggle').click();

    // Type a specific query matching first task title
    const firstTitle = (await page.locator('#problems-list .task-set-title').first().innerText()).trim();
    await page.locator('#task-search').fill(firstTitle);

    // Verify task list filters down
    const filteredCards = page.locator('#problems-list .task-set-item');
    const filteredCount = await filteredCards.count();
    expect(filteredCount).toBeGreaterThan(0);
    await expect(filteredCards.first().locator('.task-set-title')).toContainText(firstTitle);

    // Verify badge update
    await expect(taskBadge).toContainText(`${filteredCount} task`);

    // Clear search
    await page.locator('#task-search').fill('');
    await expect(taskBadge).toHaveText(initialBadgeText);
  });

  test('shows empty state when search query returns no matching tasks', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    await page.locator('#task-filter-toggle').click();
    await page.locator('#task-search').fill('NonExistentTaskQueryXYZ999');

    await expect(page.locator('#problems-list.empty-state')).toBeVisible();
    await expect(page.locator('#problems-list.empty-state h4')).toHaveText('No Exercises Found');
    await expect(page.locator('#task-count-badge')).toHaveText('0 tasks listed');
  });

  test('filters tasks by scope checkboxes', async ({ page }) => {
    await page.goto('/global-statistics');
    await page.waitForSelector('#problems-list .task-set-item', { timeout: 15000 });

    await page.locator('#task-filter-toggle').click();

    // Select 'title' scope by clicking its label (Bootstrap custom checkbox)
    const titleCheckbox = page.locator('#scope-title');
    await page.locator('label[for="scope-title"]').click();
    await expect(titleCheckbox).toBeChecked();

    // Ensure checking another scope unchecks previous single-select scope checkbox
    const teacherCheckbox = page.locator('#scope-teacher');
    await page.locator('label[for="scope-teacher"]').click();
    await expect(teacherCheckbox).toBeChecked();
    await expect(titleCheckbox).not.toBeChecked();

    // Uncheck scope by clicking label again
    await page.locator('label[for="scope-teacher"]').click();
    await expect(teacherCheckbox).not.toBeChecked();
  });
});



