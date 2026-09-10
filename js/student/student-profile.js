import {initStudentLogout, initBurgerMenu } from '/js/core/auth-ui.js';
import { formatDate, showAlert } from '/js/utils/ui-utils.js';
initBurgerMenu();

// Init student logout
initStudentLogout();

// DOM elements
const userNameEl = document.getElementById('user-name');
const profileUsernameEl = document.getElementById('profile-username');
const profileCreatedEl = document.getElementById('profile-created');
const profileEmailEl = document.getElementById('profile-email');
const enrolledSetsContainer = document.getElementById('enrolled-sets-container');

const changeEmailForm = document.getElementById('change-email-form');
const emailAlertPlaceholder = document.getElementById('email-alert-placeholder');

const changePasswordForm = document.getElementById('change-password-form');
const passwordAlertPlaceholder = document.getElementById(
	'password-alert-placeholder'
);
const backButton = document.getElementById('page-back-btn');

if (backButton) {
	const lastTaskSetUrl = localStorage.getItem('last_task_set_url');
	backButton.href = lastTaskSetUrl || '/';
}

let taskSetNavigationModal = null;
let taskSetNavigationKeyHandler = null;

if (enrolledSetsContainer) {
	enrolledSetsContainer.addEventListener('click', (event) => {
		const link = event.target.closest('.profile-task-set-link');
		if (!link) return;

		const currentSetUrl = normalizePath(enrolledSetsContainer.dataset.currentSetUrl);
		const currentSetIncomplete = enrolledSetsContainer.dataset.currentSetIncomplete === 'true';
		const targetUrl = normalizePath(link.getAttribute('href'));

		if (currentSetIncomplete && currentSetUrl && targetUrl !== currentSetUrl) {
			event.preventDefault();
			showTaskSetNavigationModal(link.href);
		}
	});
}

// Helpers for alerts


function buildTaskSetUrl(teacherUsername, uniqueLinkCode) {
	return `/${encodeURIComponent(teacherUsername)}/set/${encodeURIComponent(uniqueLinkCode)}/tasks`;
}

function normalizePath(path) {
	return (path || '').replace(/\/$/, '');
}

function hideTaskSetNavigationModal() {
	if (!taskSetNavigationModal) return;
	if (taskSetNavigationKeyHandler) {
		document.removeEventListener('keydown', taskSetNavigationKeyHandler);
		taskSetNavigationKeyHandler = null;
	}
	taskSetNavigationModal.remove();
	taskSetNavigationModal = null;
}

function showTaskSetNavigationModal(targetUrl) {
	hideTaskSetNavigationModal();

	const overlay = document.createElement('div');
	overlay.className = 'task-set-nav-overlay';
	overlay.innerHTML = `
		<div class="task-set-nav-modal" role="dialog" aria-modal="true" aria-labelledby="task-set-nav-title">
			<div class="task-set-nav-icon">!</div>
			<h3 id="task-set-nav-title">Current task set is still in progress</h3>
			<p>Please finish the current task set before moving on to another one.</p>
			<div class="task-set-nav-actions">
				<button type="button" class="btn btn-outline-secondary" data-action="close">OK</button>
				<button type="button" class="btn btn-primary" data-action="open">Open anyway</button>
			</div>
		</div>
	`;

	overlay.addEventListener('click', (event) => {
		if (event.target === overlay) {
			hideTaskSetNavigationModal();
		}
	});

	overlay.querySelector('[data-action="close"]').addEventListener('click', hideTaskSetNavigationModal);
	overlay.querySelector('[data-action="open"]').addEventListener('click', () => {
		hideTaskSetNavigationModal();
		window.location.href = targetUrl;
	});

	taskSetNavigationKeyHandler = function onKeyDown(event) {
		if (event.key === 'Escape') {
			hideTaskSetNavigationModal();
		}
	};
	document.addEventListener('keydown', taskSetNavigationKeyHandler);

	document.body.appendChild(overlay);
	taskSetNavigationModal = overlay;
}

function renderJoinedTaskSets(taskSets, username, lastSetUrl) {
	if (!enrolledSetsContainer) return;

	if (!taskSets || taskSets.length === 0) {
		enrolledSetsContainer.innerHTML = `
			<div class="text-muted">You have not joined any task sets yet.</div>
		`;
		return;
	}

	const activeSets = taskSets.filter((taskSet) => !taskSet.is_completed);
	const completedSets = taskSets.filter((taskSet) => taskSet.is_completed);
	const normalizedLastSetUrl = normalizePath(lastSetUrl);
	const currentSet = taskSets.find(
		(taskSet) => normalizePath(buildTaskSetUrl(taskSet.teacher_username, taskSet.unique_link_code)) === normalizedLastSetUrl
	);
	const currentSetIncomplete = Boolean(currentSet && !currentSet.is_completed);

	enrolledSetsContainer.dataset.currentSetUrl = normalizedLastSetUrl;
	enrolledSetsContainer.dataset.currentSetIncomplete = String(currentSetIncomplete);

	const renderSetItem = (taskSet) => {
		const taskSetUrl = buildTaskSetUrl(taskSet.teacher_username, taskSet.unique_link_code);
		const buttonLabel = normalizePath(taskSetUrl) === normalizedLastSetUrl ? 'Current set' : 'Open set';

		return `
		<li class="list-group-item d-flex justify-content-between align-items-center">
			<div>
				<div class="font-weight-bold text-dark">${taskSet.title}</div>
				<div class="text-muted small">Teacher: ${taskSet.teacher_username || '—'}</div>
				<div class="text-muted small">${taskSet.completed_tasks || 0}/${taskSet.task_count || 0} completed</div>
			</div>
			<div class="d-flex flex-column align-items-end">
				<span class="badge ${taskSet.is_completed ? 'badge-success' : 'badge-light border'}">${taskSet.is_completed ? 'Completed' : 'In progress'}</span>
				<span class="badge badge-light border mt-2">${taskSet.unique_link_code}</span>
				<a class="btn btn-sm btn-outline-primary mt-2 profile-task-set-link" href="${taskSetUrl}">
					${buttonLabel}
				</a>
			</div>
		</li>`;
	};

	const renderGroup = (title, sets) => `
		<div class="mb-3">
			<div class="text-uppercase text-muted small font-weight-bold mb-2">${title}</div>
			<ul class="list-group list-group-flush">
				${sets.map(renderSetItem).join('')}
			</ul>
		</div>
	`;

	const sections = [];
	if (activeSets.length > 0) {
		sections.push(renderGroup('Recent joined sets', activeSets));
	}
	if (completedSets.length > 0) {
		sections.push(renderGroup('Completed sets', completedSets));
	}

	enrolledSetsContainer.innerHTML = `
		${sections.join('')}
	`;
}

// Load student profile data
async function loadProfile() {
	try {
		const res = await fetch('/api/student/profile', {credentials: 'include'});
		if (!res.ok) {
			if (res.status === 401) {
				showUnauthorizedState();
			} else {
				if (enrolledSetsContainer) {
					enrolledSetsContainer.innerHTML =
						'<div class="text-danger">Failed to load profile data.</div>';
				}
			}
			return;
		}

		const data = await res.json();

		// Set user info displays
		if (userNameEl) userNameEl.textContent = data.username;
		if (profileUsernameEl) profileUsernameEl.textContent = data.username;
		if (profileEmailEl) profileEmailEl.textContent = data.email;
		if (profileCreatedEl)
			profileCreatedEl.textContent = formatDate(data.student_created_at);

		// Show the navbar user-info section (contains burger menu and logout)
		const userInfoEl = document.getElementById('user-info');
		if (userInfoEl) userInfoEl.style.display = 'flex';
		// Hide login form since student is authenticated
		const loginFormEl = document.getElementById('login-form');
		if (loginFormEl) loginFormEl.style.display = 'none';

		// Save student name fallback in local storage
		localStorage.setItem('nickname', data.username);

		// Keep profile navigation focused on the active task-set context when available.
		const lastSetUrl = localStorage.getItem('last_task_set_url') || '/';
		const profileLink = document.getElementById('profile-link');
		if (profileLink) {
			profileLink.href = lastSetUrl;
			profileLink.title = 'Back to Tasks';
		}
		const userRoleEl = document.getElementById('user-role');
		if (userRoleEl) {
			userRoleEl.textContent = 'Student';
			userRoleEl.style.display = 'inline-block';
			userRoleEl.className = 'badge badge-success';
		}
		renderJoinedTaskSets(data.joined_task_sets, data.username, lastSetUrl);
	} catch (error) {
		console.error('Error loading student profile:', error);
		if (enrolledSetsContainer) {
			enrolledSetsContainer.innerHTML =
				'<div class="text-danger">Network error loading profile.</div>';
		}
	}
}

function showUnauthorizedState() {
	document.body.innerHTML = `
    <div class="container py-5 text-center">
      <div class="card-soft p-5 mx-auto" style="max-width: 500px; border-radius: 16px;">
        <i class="fas fa-exclamation-triangle text-warning mb-3" style="font-size: 3rem;"></i>
        <h2 class="mb-3">Access Denied</h2>
        <p class="text-muted">You must log in to view this page. Please use the task set link provided by your teacher to access your tasks and log in.</p>
        <hr class="my-4">
        <a href="/" class="btn btn-primary" style="background-color: #0284c7; border-color: #0284c7; border-radius: 8px;">
          Go to Homepage
        </a>
      </div>
    </div>
  `;
}
// Form Handlers
changeEmailForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	emailAlertPlaceholder.innerHTML = '';

	const email = document.getElementById('new-email').value;
	const password = document.getElementById('email-confirm-password').value;

	try {
		const res = await fetch('/api/student/profile/email', {
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
	const new_password_confirm = document.getElementById(
		'new-password-confirm'
	).value;

	if (new_password !== new_password_confirm) {
		showAlert(passwordAlertPlaceholder, 'New passwords do not match.');
		return;
	}

	if (new_password.length < 8) {
		showAlert(passwordAlertPlaceholder, 'New password must be at least 8 characters long.');
		return;
	}

	try {
		const res = await fetch('/api/student/profile/password', {
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
