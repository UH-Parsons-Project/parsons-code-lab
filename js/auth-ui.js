/**
 * Authentication UI management module
 * Handles login forms, logout buttons, and authentication state display
 */

import { verifyAuth, getAuthToken, getUsername, setAuth, clearAuth } from './auth-utils.js';

/**
 * Initialize login page authentication UI
 * Handles login form submission and checks if user is already logged in
 */
export function initLoginPage() {
	const loginForm = document.getElementById('login-form');
	const logoutBtn = document.getElementById('logout-btn');
	const userInfo = document.getElementById('user-info');
	const errorMessage = document.getElementById('error-message');
	const loginBtn = document.getElementById('login-btn');
	
	if (!loginForm) {
		console.error('Login form not found');
		return;
	}
	
	// Check if user is already logged in
	async function checkAuth() {
		const userData = await verifyAuth();
		if (userData) {
			showUserInfo(userData.username);
		} else {
			showLoginForm();
		}
	}
	
	function showUserInfo(username) {
		loginForm.style.display = 'none';
		if (userInfo) {
			userInfo.style.display = 'block';
			const userNameElement = document.getElementById('user-name');
			if (userNameElement) {
				userNameElement.textContent = username;
			}
		}
	}
	
	function showLoginForm() {
		loginForm.style.display = 'flex';
		if (userInfo) {
			userInfo.style.display = 'none';
		}
	}
	
	function showError(message) {
		if (errorMessage) {
			errorMessage.textContent = message;
			errorMessage.style.display = 'block';
			setTimeout(() => {
				errorMessage.style.display = 'none';
			}, 5000);
		}
	}
	
	// Handle login form submission
	loginForm.addEventListener('submit', async function(e) {
		e.preventDefault();
		const username = document.getElementById('username').value.trim();
		const password = document.getElementById('password').value;
		
		if (!username || !password) {
			showError('Please enter username and password');
			return;
		}
		
		// Disable button during request
		if (loginBtn) {
			loginBtn.disabled = true;
			loginBtn.textContent = 'Logging in...';
		}
		
		try {
			// OAuth2 expects form data, not JSON
			const formData = new URLSearchParams();
			formData.append('username', username);
			formData.append('password', password);
			
			const response = await fetch('/api/login/access-token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: formData
			});
			
			if (response.ok) {
				const data = await response.json();
				
				// Get user info using the token
				const userResponse = await fetch('/api/me', {
					headers: {
						'Authorization': `Bearer ${data.access_token}`
					}
				});
				
				if (userResponse.ok) {
					const userData = await userResponse.json();
					// Store token and username
					setAuth(data.access_token, userData.username);
					
					// Clear form
					document.getElementById('username').value = '';
					document.getElementById('password').value = '';
					
					// Show user info
					showUserInfo(userData.username);
					
					// Redirect to exercise list
					window.location.href = '/exerciselist';
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
		logoutBtn.addEventListener('click', async function() {
			// Call logout endpoint to clear cookie
			await fetch('/api/logout', { method: 'POST' });
			clearAuth();
			showLoginForm();
		});
	}
	
	// Check authentication on page load
	checkAuth();
}

/**
 * Initialize protected page authentication UI
 * Verifies user is logged in and handles logout, redirects to login if not authenticated
 * @param {string} loginPageUrl - URL to redirect to if not authenticated (default: '../index.html')
 */
export async function initProtectedPage(loginPageUrl = '../index.html') {
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
	
	// Update username in nav if element exists
	const userNameElement = document.getElementById('user-name');
	if (userNameElement) {
		userNameElement.textContent = userData.username;
	}
	
	// Handle logout button
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async function() {
			// Call logout endpoint to clear cookie
			await fetch('/api/logout', { method: 'POST' });
			clearAuth();
			window.location.href = loginPageUrl;
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
		
		const userInfo = document.getElementById('user-info');
		const loginForm = document.getElementById('login-form');
		
		if (userInfo) userInfo.style.display = 'block';
		if (loginForm) loginForm.style.display = 'none';
	}
	
	// Setup logout handler
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async function() {
			// Call logout endpoint to clear cookie
			await fetch('/api/logout', { method: 'POST' });
			clearAuth();
			window.location.reload();
		});
	}
}
