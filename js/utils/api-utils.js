export async function fetchJsonWithError(url, errorMessage = 'An error occurred', options = {}) {
    const requestOptions = {
        ...options,
        credentials: options.credentials || 'include',
    };
    try {
        const response = await fetch(url, requestOptions);
        if (!response.ok) {
            let detail = response.statusText;
            try {
                const errorData = await response.json();
                detail = errorData.detail || detail;
            } catch {
                // Ignore JSON parse error if response is not JSON
            }
            throw new Error(`${errorMessage}: ${detail}`);
        }
        return await response.json();
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export async function authFetch(url, options = {}) {
    options.credentials = 'include';
    return fetch(url, options);
}
