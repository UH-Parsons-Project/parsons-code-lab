// Initialize object for manual local storage in case 'localStorage' isn't supported
const veryLocalStorage = {};
// Ensures that the browser supports 'localStorage'
// returns true if 'localStorage' is defined and usable, else false
function supportsStorage() {
	try {
		return 'localStorage' in window && window['localStorage'] !== null;
	} catch (e) {
		return false;
	}
}
// returns saved answers from local storage if they exist, else defaultValue
export function get(key, defaultValue) {
	let value;
	if (!supportsStorage()) {
		value = veryLocalStorage[key];
	} else {
		value = localStorage.getItem(key);
	}
	return value === null || typeof value === 'undefined' ? defaultValue : value;
}
// saves answers in local storage
export function set(key, value) {
	if (!supportsStorage()) {
		veryLocalStorage[key] = value;
	} else {
		localStorage.setItem(key, value);
	}
}
