import { showAlert } from '../utils/ui-utils.js';
import { setAuth } from '../core/auth-utils.js';
const form = document.getElementById('register-form');
const alertPlaceholder = document.getElementById('alert-placeholder');



form.addEventListener('submit', async (e) => {
	e.preventDefault();
	alertPlaceholder.innerHTML = '';

	const payload = {
		username: form.querySelector('#username').value,
		email: form.querySelector('#email').value,
		password: form.querySelector('#password').value,
		password_confirm: form.querySelector('#password_confirm').value,
		registration_token: form.querySelector('#registration_token').value,
	};

	// Client-side confirmation check
	if (payload.password !== payload.password_confirm) {
		showAlert(alertPlaceholder, 'Passwords do not match');
		return;
	}

	if (payload.password.length < 8) {
		showAlert(alertPlaceholder, 'Password must be at least 8 characters long.');
		return;
	}

	try {
		const res = await fetch('/api/teacher_register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		const data = await res.json();
		if (!res.ok) {
			showAlert(alertPlaceholder, data.detail || data.message || 'Registration failed');
			return;
		}

		showAlert(alertPlaceholder, 'Registration successful.', 'success');
		if (data.access_token) {
			setAuth(data.access_token, data.username || payload.username);
		}
		form.reset();
		setTimeout(() => { window.location.href = '/teacher-dashboard'; }, 1000);
	} catch (err) {
		showAlert(alertPlaceholder, 'Network error');
	}
});
