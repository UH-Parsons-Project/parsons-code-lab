const OBSERVER_MODE_KEY = 'parsons-observer-mode';

let fallbackValue = false;

function supportsStorage() {
	try {
		return typeof window !== 'undefined' && 'localStorage' in window && window.localStorage !== null;
	} catch {
		return false;
	}
}

export function isObserverModeEnabled() {
	if (!supportsStorage()) return fallbackValue;
	return window.localStorage.getItem(OBSERVER_MODE_KEY) === 'true';
}

export function setObserverMode(enabled) {
	const value = Boolean(enabled);

	if (supportsStorage()) {
		window.localStorage.setItem(OBSERVER_MODE_KEY, String(value));
	} else {
		fallbackValue = value;
	}

	window.dispatchEvent(new CustomEvent('observer-mode-changed', {
		detail: { enabled: value },
	}));
}

export function toggleObserverMode() {
	const enabled = !isObserverModeEnabled();
	setObserverMode(enabled);
	return enabled;
}
