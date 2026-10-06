/**
 * Return the user-facing opening status for a task set.
 *
 * A missing `opens_at` means that the task set is open immediately. An
 * explicit opening time is only used to distinguish a future opening from an
 * already opened task set. Expiration takes precedence over both states.
 */
export function getTaskSetOpeningStatus(taskSet, now = new Date()) {
	const opensAt = taskSet?.opens_at ? new Date(taskSet.opens_at) : null;
	const expiresAt = taskSet?.expires_at ? new Date(taskSet.expires_at) : null;

	if (expiresAt && expiresAt < now) {
		return {
			status: 'expired',
			label: 'Expired',
			date: expiresAt,
		};
	}

	if (!opensAt) {
		return {
			status: 'open',
			label: 'Open',
			date: null,
		};
	}

	if (opensAt > now) {
		return {
			status: 'scheduled',
			label: 'Opens',
			date: opensAt,
		};
	}

	return {
		status: 'open',
		label: 'Opened',
		date: opensAt,
	};
}
