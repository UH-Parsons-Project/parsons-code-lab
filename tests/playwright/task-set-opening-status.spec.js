import { test, expect } from '@playwright/test';

test('task set opening status treats a missing opening time as open immediately', async ({ page }) => {
	await page.goto('/');

	const statuses = await page.evaluate(async () => {
		const { getTaskSetOpeningStatus } = await import('/js/utils/task-set-status.js');
		const now = new Date('2026-10-02T12:00:00.000Z');

		return {
			immediate: getTaskSetOpeningStatus({ opens_at: null }, now),
			upcoming: getTaskSetOpeningStatus({ opens_at: '2026-10-03T12:00:00.000Z' }, now),
			opened: getTaskSetOpeningStatus({ opens_at: '2026-10-01T12:00:00.000Z' }, now),
			expired: getTaskSetOpeningStatus({ expires_at: '2026-10-01T12:00:00.000Z' }, now),
		};
	});

	expect(statuses.immediate).toMatchObject({ status: 'open', label: 'Open', date: null });
	expect(statuses.upcoming).toMatchObject({ status: 'scheduled', label: 'Opens' });
	expect(statuses.opened).toMatchObject({ status: 'open', label: 'Opened' });
	expect(statuses.expired).toMatchObject({ status: 'expired', label: 'Expired' });
});
