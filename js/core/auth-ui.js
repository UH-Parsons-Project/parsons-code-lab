import "../components/help-tour.js";
/**
 * Authentication UI management module
 * Handles login forms, logout buttons, and authentication state display
 */

import {
	verifyAuth,
	getAuthToken,
	getUsername,
	setAuth,
	clearAuth,
} from '../core/auth-utils.js';
import { authFetch } from '../utils/api-utils.js';
import { getRoleBadgeClass, showError } from '../utils/ui-utils.js';

function setExercisesButtonVisible(visible) {
	const exercisesBtn = document.getElementById('exercises-btn');
	if (exercisesBtn) {
		exercisesBtn.style.display = visible ? 'inline-block' : 'none';
	}
	const globalStatsBtn = document.getElementById('global-stats-btn');
	if (globalStatsBtn) {
		globalStatsBtn.style.display = visible ? 'inline-block' : 'none';
	}
}



/**
 * Display a user role with appropriate styling
 */
function displayUserRole(roleElement, role) {
	if (!roleElement || !role) return;

	roleElement.textContent = role;
	roleElement.className = 'badge ' + getRoleBadgeClass(role);
	roleElement.style.display = 'inline';
	roleElement.style.marginLeft = '8px';
}

/**
 * Initialize login page authentication UI
 * Handles login form submission and checks if user is already logged in
 */
export function initLoginPage() {
	const loginForm = document.getElementById('login-form');
	const logoutBtn = document.getElementById('logout-btn');
	const userInfo = document.getElementById('user-info');

	const loginBtn = document.getElementById('login-btn');
	const teacherInstructions = document.getElementById(
		'teacher-only-instructions'
	);
	const logoLink =
		document.querySelector('.title-logo-link') ||
		document.querySelector('.navbar-logo')?.closest('a');
	const teacherInstructionsLoadingMarkup = `
		<div class="instructions">
			<p class="mb-0 text-muted">Loading teacher instructions...</p>
		</div>
	`;
	const teacherInstructionsPlaceholderMarkup = `
		<div class="instructions">
			<p class="mb-0 text-muted">Log in to view the teacher-only instructions.</p>
		</div>
	`;
	let teacherInstructionsLoaded = false;
	let teacherInstructionsRequestInFlight = false;
	let teacherInstructionsLoadVersion = 0;

	if (!loginForm) {
		console.error('Login form not found');
		return;
	}

	function setLogoRedirectForAuth(isAuthenticated) {
		if (!logoLink) {
			return;
		}

		logoLink.href = isAuthenticated ? '/teacher-dashboard' : '/';
	}

	// Check if user is already logged in
	async function checkAuth() {
		const userData = await verifyAuth();
		if (userData) {
			showUserInfo(userData.username, userData.role);
			showTeacherInstructions();
		} else {
			showLoginForm();
		}
	}

	function showUserInfo(username, role) {
		loginForm.style.display = 'none';
		setLogoRedirectForAuth(true);
		if (userInfo) {
			userInfo.style.display = 'flex';
			const userNameElement = document.getElementById('user-name');
			if (userNameElement) {
				userNameElement.textContent = username;
			}
			const userRoleElement = document.getElementById('user-role');
			displayUserRole(userRoleElement, role);
		}
		setExercisesButtonVisible(true);
	}

	function showTeacherInstructions() {
		if (teacherInstructions) {
			teacherInstructions.style.display = 'block';
			if (!teacherInstructionsLoaded && !teacherInstructionsRequestInFlight) {
				teacherInstructionsLoadVersion += 1;
				teacherInstructions.innerHTML = teacherInstructionsLoadingMarkup;
				loadTeacherInstructions(teacherInstructionsLoadVersion);
			}
		}
	}

	function hideTeacherInstructions() {
		if (teacherInstructions) {
			teacherInstructions.style.display = 'none';
			teacherInstructions.innerHTML = teacherInstructionsPlaceholderMarkup;
			teacherInstructionsLoaded = false;
			teacherInstructionsRequestInFlight = false;
			teacherInstructionsLoadVersion += 1;
		}
	}

	async function loadTeacherInstructions(loadVersion) {
		if (!teacherInstructions || teacherInstructionsRequestInFlight) {
			return;
		}

		teacherInstructionsRequestInFlight = true;

		try {
			const response = await authFetch('/instructions/teacher-content');
			if (!response.ok) {
				throw new Error(
					`Failed to load teacher instructions: ${response.status}`
				);
			}

			if (loadVersion !== teacherInstructionsLoadVersion) {
				return;
			}

			teacherInstructions.innerHTML = await response.text();
			teacherInstructionsLoaded = true;
		} catch (error) {
			if (loadVersion !== teacherInstructionsLoadVersion) {
				return;
			}

			console.error('Teacher instructions load error:', error);
			teacherInstructions.innerHTML = `
				<div class="instructions">
					<p class="text-danger mb-0">Could not load teacher instructions.</p>
				</div>
			`;
		} finally {
			if (loadVersion === teacherInstructionsLoadVersion) {
				teacherInstructionsRequestInFlight = false;
			}
		}
	}

	function showLoginForm() {
		loginForm.style.display = 'flex';
		setLogoRedirectForAuth(false);
		if (userInfo) {
			userInfo.style.display = 'none';
		}
		hideTeacherInstructions();
		setExercisesButtonVisible(false);
	}



	// Handle login form submission
	loginForm.addEventListener('submit', async function (e) {
		e.preventDefault();
		const username = document.getElementById('username').value.trim();
		const password = document.getElementById('password').value;

		if (!username || !password) {
			showError('Please enter username or email and password');
			return;
		}

		// Disable button during request
		if (loginBtn) {
			loginBtn.disabled = true;
			loginBtn.textContent = 'Logging in...';
		}

		try {
			// If we're on a task_set page (/{username}/set/<code>) use student login
			const pathMatch = window.location.pathname.match(
				/^\/([^/]+)\/set\/([^/]+)/
			);
			if (pathMatch) {
				const teacherUsername = pathMatch[1];
				const code = pathMatch[2];
				const response = await fetch('/api/student_login', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({
						email: username,
						password,
						unique_link_code: code,
					}),
				});
				if (response.ok) {
					const data = await response.json();
					const displayName = data.username || username;
					// Keep navbar greeting consistent on student pages.
					localStorage.setItem('nickname', displayName);
					// Student session cookie set by backend; redirect to tasks
					window.location.href = `/${teacherUsername}/set/${code}/tasks`;
					return;
				} else {
					const err = await response.json();
					showError(err.detail || 'Login failed');
					return;
				}
			}

			// Fallback to teacher OAuth2 login for other pages
			const formData = new URLSearchParams();
			formData.append('username', username);
			formData.append('password', password);

			const response = await fetch('/api/login/access-token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: formData,
			});

			if (response.ok) {
				const data = await response.json();

				// Get user info using the token
				const userResponse = await fetch('/api/me', {
					headers: {
						Authorization: `Bearer ${data.access_token}`,
					},
				});

				if (userResponse.ok) {
					const userData = await userResponse.json();
					// Store token and username
					setAuth(data.access_token, userData.username);

					// Clear form
					document.getElementById('username').value = '';
					document.getElementById('password').value = '';

					// Show user info
					showUserInfo(userData.username, userData.role);

					// Redirect to exercise list
					window.location.href = '/teacher-dashboard';
				} else {
					showError('Failed to get user information');
				}
			} else {
				const error = await response.json();
				showError(error.detail || 'Login failed');
			}
		} catch (error) {
			showError('Network error. Please try again.');
			console.error('Login error:', error);
		} finally {
			if (loginBtn) {
				loginBtn.disabled = false;
				loginBtn.textContent = 'Login';
			}
		}
	});

	// Handle logout
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async function () {
			const isStudentPage = /^\/[^/]+\/set\//.test(window.location.pathname);
			if (isStudentPage) {
				await fetch('/api/student_logout', {method: 'POST'});
				localStorage.removeItem('nickname');
			} else {
				await fetch('/api/logout', {method: 'POST'});
			}
			clearAuth();
			showLoginForm();
		});
	}

	// Handle register button
	const registerBtn = document.getElementById('register-btn');
	// console.log('Register button found:', registerBtn); // Debug log
	if (registerBtn) {
		registerBtn.addEventListener('click', function () {
			const isStudentPage = /^\/[^/]+\/set\//.test(window.location.pathname);
			if (!isStudentPage) {
				// console.log('Register button clicked'); // Debug log
				window.location.href = '/teacher-register';
			}
		});
	}

	// If redirected from registration, focus username field
	const usernameInput = document.getElementById('username');
	const params = new URLSearchParams(window.location.search);
	if (params.get('focus') === 'username' && usernameInput) {
		usernameInput.focus();
	}

	// Check authentication on page load
	checkAuth();
}

/**
 * Initialize navbar exercises button visibility based on auth state.
 */
export async function initNavbarExercisesButton() {
	const userData = await verifyAuth();
	setExercisesButtonVisible(!!userData);
}

/**
 * Initialize protected page authentication UI
 * Verifies user is logged in and handles logout, redirects to login if not authenticated
 * @param {string} loginPageUrl - URL to redirect to if not authenticated (default: '/')
 */
export async function initProtectedPage(loginPageUrl = '/') {
	const token = getAuthToken();
	const username = getUsername();

	// If no token or username, redirect immediately
	if (!token || !username) {
		window.location.href = loginPageUrl;
		return;
	}

	// Verify token with backend
	const userData = await verifyAuth();
	if (!userData) {
		// Token invalid, redirect to login
		window.location.href = loginPageUrl;
		return;
	}

	// Show the authenticated navbar state so the burger menu becomes visible.
	const userInfo = document.getElementById('user-info');
	if (userInfo) {
		userInfo.style.display = 'flex';
	}

	const loginForm = document.getElementById('login-form');
	if (loginForm) {
		loginForm.style.display = 'none';
	}

	// Update username in nav if element exists
	const userNameElement = document.getElementById('user-name');
	if (userNameElement) {
		userNameElement.textContent = userData.username;
	}

	// Update user role if element exists
	const userRoleElement = document.getElementById('user-role');
	displayUserRole(userRoleElement, userData.role);

	// Handle logout button
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async function () {
			// Call logout endpoint to clear cookie
			await fetch('/api/logout', {method: 'POST'});
			clearAuth();

			// Hide user info elements immediately
			const userInfo = document.getElementById('user-info');
			if (userInfo) userInfo.style.display = 'none';

			// Hide user-name span and logout button if not in user-info div
			const userNameSpan =
				document.querySelector('#user-name')?.parentElement;
			if (userNameSpan && !userInfo?.contains(userNameSpan)) {
				userNameSpan.style.display = 'none';
			}
			if (logoutBtn && !userInfo?.contains(logoutBtn)) {
				logoutBtn.style.display = 'none';
			}

			// Redirect with cache-busting query parameter to force page reload
			window.location.href = loginPageUrl + '?' + new Date().getTime();
		});
	}
}

/**
 * Simple function to check auth and display username without redirecting
 * Useful for pages that want to show auth status but don't require login
 */
export async function displayAuthStatus() {
	const userData = await verifyAuth();

	if (userData) {
		const userNameElement = document.getElementById('user-name');
		if (userNameElement) {
			userNameElement.textContent = userData.username;
		}

		const userRoleElement = document.getElementById('user-role');
		displayUserRole(userRoleElement, userData.role);

		const userInfo = document.getElementById('user-info');
		const loginForm = document.getElementById('login-form');

		if (userInfo) userInfo.style.display = 'block';
		if (loginForm) loginForm.style.display = 'none';
		setExercisesButtonVisible(true);
	} else {
		const userInfo = document.getElementById('user-info');
		const loginForm = document.getElementById('login-form');

		if (userInfo) userInfo.style.display = 'none';
		if (loginForm) loginForm.style.display = 'flex';
		setExercisesButtonVisible(false);
	}

	// Setup logout handler
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async function () {
			// Call logout endpoint to clear cookie
			await fetch('/api/logout', {method: 'POST'});
			clearAuth();
			window.location.reload();
		});
	}
}

/**
 * Initialize user name display on student pages
 * @param {string} userNameId - ID of the user name element
 * @param {string} userRoleId - ID of the user role element
 * @param {string} userInfoId - ID of the user info element
 * @param {boolean} preferNickname - Whether to prefer nickname over username
 */
export async function initSignedInAs({
	userNameId = 'user-name',
	userRoleId = 'user-role',
	userInfoId = 'user-info',
	preferNickname = false,
} = {}) {
	// Store last visited task set URL in localStorage
	const currentPath = window.location.pathname;
	const setMatch = currentPath.match(/^\/[^/]+\/set\/[^/]+/);
	if (setMatch) {
		localStorage.setItem('last_task_set_url', setMatch[0] + '/tasks');
	}

	const userNameEl = document.getElementById(userNameId);
	const userRoleEl = document.getElementById(userRoleId);
	const userInfoEl = document.getElementById(userInfoId);

	if (!userNameEl) return;

	let name = null;
	let role = null;

	// Student pages can prefer nickname
	if (preferNickname) {
		// Prefer student nickname, but fall back to stored username.
		name = localStorage.getItem('nickname') || localStorage.getItem('username');
		role = 'Student';
	} else {
		// Teacher flow
		name = localStorage.getItem('username');
	}

	// Safe backend fallback (already existing helper)
	if (!name) {
		const userData = await verifyAuth();
		if (userData?.username) {
			name = userData.username;
			role = userData.role;
			localStorage.setItem('username', name);
		}
	}

	// Cookie-session fallback for pages that don't have localStorage token.
	if (!name) {
		try {
			const response = await fetch('/api/me', {credentials: 'include'});
			if (response.ok) {
				const userData = await response.json();
				if (userData?.username) {
					name = userData.username;
					role = userData.role;
					localStorage.setItem('username', name);
				}
			}
		} catch (error) {
			console.error('Signed-in name fallback failed:', error);
		}
	}

	// Student cookie-session fallback — /api/me only covers teacher JWT tokens.
	// Student sessions are cookie-based; check /api/student/profile instead.
	if (!name) {
		try {
			const response = await fetch('/api/student/profile', {credentials: 'include'});
			if (response.ok) {
				const userData = await response.json();
				if (userData?.username) {
					name = userData.username;
					role = 'Student';
					localStorage.setItem('nickname', name);
				}
			}
		} catch (error) {
			console.error('Student session fallback failed:', error);
		}
	}

	if (name) {
		userNameEl.textContent = name;
		displayUserRole(userRoleEl, role);
		if (userInfoEl) userInfoEl.style.display = 'flex';
		// Hide login form when user is authenticated
		const loginForm = document.getElementById('login-form');
		if (loginForm) loginForm.style.display = 'none';
	} else {
		if (userInfoEl) userInfoEl.style.display = 'none';
	}
}

/**
 * Initialize student logout behavior for /{username}/set/{unique_link_code}/... pages.
 */
export function initStudentLogout({
	logoutButtonId = 'logout-btn',
	redirectFallback = '/',
} = {}) {
	const logoutBtn = document.getElementById(logoutButtonId);
	if (!logoutBtn) return;

	logoutBtn.addEventListener('click', async () => {
		await fetch('/api/student_logout', {method: 'POST'});
		localStorage.removeItem('nickname');

		const pathParts = window.location.pathname.split('/').filter(Boolean);
		const username = pathParts[0];
		const uniqueLinkCode = pathParts[2];

		if (username && uniqueLinkCode) {
			window.location.href = `/${username}/set/${uniqueLinkCode}`;
			return;
		}

		const lastSetUrl = localStorage.getItem('last_task_set_url') || '';
		const setMatch = lastSetUrl.match(/^\/([^/]+)\/set\/([^/]+)(?:\/tasks(?:\/\d+)?)?\/?$/);
		if (setMatch) {
			window.location.href = `/${setMatch[1]}/set/${setMatch[2]}`;
			return;
		}

		window.location.href = redirectFallback;
	});
}

/**
 * Initialize burger menu for teacher pages
 */
export function initBurgerMenu() {
	const toggle = document.getElementById('navbar-burger-toggle');
	const dropdown = document.getElementById('navbar-burger-dropdown');

	if (!toggle || !dropdown) return;

	// Toggle dropdown on button click
	toggle.addEventListener('click', (e) => {
		e.stopPropagation();
		dropdown.classList.toggle('show');
		toggle.setAttribute('aria-expanded', dropdown.classList.contains('show'));
	});

	// Close dropdown when clicking on a link
	const links = dropdown.querySelectorAll('.navbar-burger-item');
	links.forEach((link) => {
		link.addEventListener('click', () => {
			dropdown.classList.remove('show');
			toggle.setAttribute('aria-expanded', 'false');
		});
	});

	// Close dropdown when clicking outside
	document.addEventListener('click', (e) => {
		if (!e.target.closest('.navbar-burger-menu')) {
			dropdown.classList.remove('show');
			toggle.setAttribute('aria-expanded', 'false');
		}
	});
}

