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
 * Clear cached HY login auth data stored in browser localStorage.
 * This is used when a browser session expires and the app needs to drop
 * stale teacher auth state without touching unrelated localStorage keys.
 */
export function clearHyAuth() {
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(USERNAME_KEY);
}

/**
 * Clear authentication data (logout)
 */
export function clearAuth() {
	clearHyAuth();
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

	try {
		const response = await fetch('/api/me', {
			credentials: 'include',
			headers: token
				? {
						'Authorization': `Bearer ${token}`
					}
				: {},
		});

		if (response.ok) {
			return await response.json();
		} else {
			if (token) {
				// Token is invalid, clear stale HY auth state
				clearHyAuth();
			}
			return null;
		}
	} catch (error) {
		console.error('Auth verification error:', error);
		return null;
	}
}

