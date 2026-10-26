import {initProtectedPage, initSignedInAs, initBurgerMenu} from '../core/auth-ui.js';
import { formatDate, showAlert } from '../utils/ui-utils.js';
import { fetchJsonWithError } from '../utils/api-utils.js';

// Enforce authentication check, display username/role in navbar, initialize hamburger menu
initProtectedPage('/');
initSignedInAs();
initBurgerMenu();

// DOM elements
const userNameEl = document.getElementById('user-name');
const profileUsernameEl = document.getElementById('profile-username');
const profileCreatedEl = document.getElementById('profile-created');
const profileEmailEl = document.getElementById('profile-email');

const changeEmailForm = document.getElementById('change-email-form');
const emailAlertPlaceholder = document.getElementById('email-alert-placeholder');

const changePasswordForm = document.getElementById('change-password-form');
const passwordAlertPlaceholder = document.getElementById('password-alert-placeholder');

// Helpers for alerts


// Load teacher profile data
async function loadProfile() {
	try {
		const data = await fetchJsonWithError(
			'/api/teacher/profile',
			'Failed to fetch profile',
		);

		// Set profile details displays
		if (profileUsernameEl) profileUsernameEl.textContent = data.username;
		if (profileEmailEl) profileEmailEl.textContent = data.email;
		if (profileCreatedEl) profileCreatedEl.textContent = formatDate(data.created_at);

		// Also update the navbar username element if it wasn't already
		if (userNameEl && !userNameEl.textContent) {
			userNameEl.textContent = data.username;
		}
	} catch (error) {
		console.error('Error loading teacher profile:', error);
	}
}

// Form Handlers
changeEmailForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	emailAlertPlaceholder.innerHTML = '';

	const email = document.getElementById('new-email').value;
	const password = document.getElementById('email-confirm-password').value;

	try {
		const res = await fetch('/api/teacher/profile/email', {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email, password}),
			credentials: 'include',
		});

		const data = await res.json();
		if (!res.ok) {
			showAlert(emailAlertPlaceholder, data.detail || 'Failed to update email address.');
			return;
		}

		showAlert(emailAlertPlaceholder, 'Email address successfully updated.', 'success');
		changeEmailForm.reset();
		if (profileEmailEl) profileEmailEl.textContent = email;
	} catch (err) {
		showAlert(emailAlertPlaceholder, 'Network error updating email.');
	}
});

changePasswordForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	passwordAlertPlaceholder.innerHTML = '';

	const current_password = document.getElementById('current-password').value;
	const new_password = document.getElementById('new-password').value;
	const new_password_confirm = document.getElementById('new-password-confirm').value;

	if (new_password !== new_password_confirm) {
		showAlert(passwordAlertPlaceholder, 'New passwords do not match.');
		return;
	}

	if (new_password.length < 8) {
		showAlert(passwordAlertPlaceholder, 'New password must be at least 8 characters long.');
		return;
	}

	try {
		const res = await fetch('/api/teacher/profile/password', {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				current_password,
				new_password,
				new_password_confirm,
			}),
			credentials: 'include',
		});

		const data = await res.json();
		if (!res.ok) {
			showAlert(passwordAlertPlaceholder, data.detail || 'Failed to update password.');
			return;
		}

		showAlert(passwordAlertPlaceholder, 'Password successfully updated.', 'success');
		changePasswordForm.reset();
	} catch (err) {
		showAlert(passwordAlertPlaceholder, 'Network error updating password.');
	}
});

// Run
loadProfile();
