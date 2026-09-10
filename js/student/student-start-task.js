import { initSignedInAs , initBurgerMenu } from '/js/core/auth-ui.js';
initBurgerMenu();
import { initStudentLogout } from '/js/core/auth-ui.js';
initSignedInAs({ preferNickname: true });
initStudentLogout();

// Extract username, unique_link_code and task_id from URL path
// Path: /{username}/set/{unique_link_code}/tasks/{task_id}/start
const pathParts = window.location.pathname.split('/').filter(p => p);
const username = pathParts[0];
const uniqueLinkCode = pathParts[2];
const taskId = pathParts[4];
const instructionsEl = document.getElementById('task-instructions');
const startBtn = document.getElementById('start-btn');

// Hide content initially to prevent flash of the start button
function hidePageContent() {
	const contentElements = [
		document.getElementById('start-btn'),
		document.getElementById('task-instructions')
	];
	contentElements.forEach(el => {
		if (el) el.style.display = 'none';
	});
}

// Show page content after verification
function showPageContent() {
	const contentElements = [
		document.getElementById('start-btn'),
		document.getElementById('task-instructions')
	];
	contentElements.forEach(el => {
		if (el) el.style.display = '';
	});
}

// Check if the user has already started this task in the database
async function checkAndRedirectIfStarted() {
	try {
		const response = await fetch(`/api/sets/${uniqueLinkCode}/tasks/${taskId}/has-started`, { credentials: 'include' });
		if (response.ok) {
			const data = await response.json();
			if (data.has_started) {
				// User has already started this task, redirect them directly to it
				window.location.href = `/${username}/set/${uniqueLinkCode}/tasks/${taskId}`;
				return; // Stop further execution
			}
		}
	} catch (error) {
		console.error('Error checking task start status:', error);
		// Fall through to show the start page if the check fails
	}

	// If we reach here, it means the task hasn't been started. Show the page content.
	showPageContent();
}

hidePageContent();
checkAndRedirectIfStarted();

// Set the page-level back button to return to the task set
const backButton = document.getElementById('page-back-btn');
if (backButton) {
	backButton.href = `/${username}/set/${uniqueLinkCode}/tasks`;
	backButton.style.display = 'inline-flex';
}

// Set the start button to create the start record and navigate to the task
if (startBtn) {
	startBtn.onclick = async function() {
		try {
			// Disable button to prevent double-clicks
			startBtn.disabled = true;
			startBtn.textContent = 'Starting...';

			// Call the backend to create the enrollment record and first session
			const response = await fetch(`/api/sets/${uniqueLinkCode}/tasks/${taskId}/start`, {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				throw new Error('Failed to start task. Please try again.');
			}

			const data = await response.json();
			sessionStorage.setItem(`task_session_${taskId}`, data.session_id);

			// On success, navigate to the task page
			window.location.href = `/${username}/set/${uniqueLinkCode}/tasks/${taskId}`;

		} catch (error) {
			console.error('Error starting task:', error);
			alert(error.message); // Inform the user
			// Re-enable button on failure
			startBtn.disabled = false;
			startBtn.textContent = 'Start Task';
		}
	};
}

// Fetch task instructions and render them
fetch(`/api/sets/${uniqueLinkCode}/tasks/${taskId}`, { credentials: 'include' })
	.then((response) => {
		if (!response.ok) {
			throw new Error('Failed to load task instructions.');
		}
		return response.json();
	})
	.then((task) => {
		if (instructionsEl) {
			instructionsEl.textContent = task.description || 'No instructions available for this task.';
		}
	})
	.catch((error) => {
		console.error('Error loading task:', error);
		if (instructionsEl) {
			instructionsEl.textContent = 'Could not load task instructions.';
		}
	});
