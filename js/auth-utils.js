/**
 * Authentication utilities for client-side JWT token management
 */

export const AUTH_TOKEN_KEY = 'auth_token';
export const USERNAME_KEY = 'username';

/**
 * Get the stored authentication token
 */
export function getAuthToken() {
	return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Get the stored username
 */
export function getUsername() {
	return localStorage.getItem(USERNAME_KEY);
}

/**
 * Store authentication token and username
 */
export function setAuth(token, username) {
	localStorage.setItem(AUTH_TOKEN_KEY, token);
	localStorage.setItem(USERNAME_KEY, username);
}

/**
 * Clear authentication data (logout)
 */
export function clearAuth() {
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(USERNAME_KEY);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
	return !!getAuthToken();
}

/**
 * Verify token with backend and return user info
 */
export async function verifyAuth() {
	const token = getAuthToken();
	if (!token) {
		return null;
	}

	try {
		const response = await fetch('/api/me', {
			headers: {
				'Authorization': `Bearer ${token}`
			}
		});

		if (response.ok) {
			return await response.json();
		} else {
			// Token is invalid, clear it
			clearAuth();
			return null;
		}
	} catch (error) {
		console.error('Auth verification error:', error);
		return null;
	}
}

/**
 * Make an authenticated API request
 */
export async function authFetch(url, options = {}) {
	const token = getAuthToken();
	if (!token) {
		throw new Error('Not authenticated');
	}

	const headers = {
		...options.headers,
		'Authorization': `Bearer ${token}`
	};

	const response = await fetch(url, {
		...options,
		headers
	});

	// If unauthorized, clear token and redirect to login
	if (response.status === 401) {
		clearAuth();
		window.location.href = '/';
		throw new Error('Session expired');
	}

	return response;
}
