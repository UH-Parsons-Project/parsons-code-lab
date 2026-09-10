import { initSignedInAs, initProtectedPage, initBurgerMenu } from '../core/auth-ui.js';
import { formatDateTime, escapeHtml, showError, makeKeyActivatable } from '../utils/ui-utils.js';
initSignedInAs();
initProtectedPage('/');
initBurgerMenu();

const params = new URLSearchParams(window.location.search);
const studentUsername = params.get('student');
const studentId = params.get('student_id');
const setId = params.get('set_id');

if (!studentId || !setId) {
	window.location.href = '/teacher-dashboard';
	throw new Error('Missing required query params: student or set_id');
}

// Set up back button
const backBtn = document.getElementById('back-btn');
if (backBtn) {
	backBtn.href = "#";
	backBtn.addEventListener('click', (e) => {
		e.preventDefault();
		history.back();
	});
}

function bindRemoveStudentButton() {
	const removeStudentBtn = document.getElementById('remove-student-btn');
	if (!removeStudentBtn) return;
	removeStudentBtn.addEventListener('click', async () => {
		const confirmed = window.confirm('Are you sure you want to remove this student and all their data from this task set?');
		if (!confirmed) return;

		removeStudentBtn.disabled = true;
		try {
			const response = await fetch(
				`/api/my_sets/${encodeURIComponent(setId)}/students/${encodeURIComponent(studentId)}`,
				{
					method: 'DELETE',
					credentials: 'include'
				}
			);

			if (response.status === 401) {
				window.location.href = '/';
				return;
			}

			if (!response.ok) {
				const body = await response.json().catch(() => null);
				const detail = body?.detail || 'Failed to remove student from this task set.';
				throw new Error(detail);
			}

			window.location.href = `/task-set-overview?set_id=${encodeURIComponent(setId)}`;
		} catch (error) {
			console.error('Error removing student from task set:', error);
			window.alert(error.message || 'Failed to remove student from this task set.');
			removeStudentBtn.disabled = false;
		}
	});
}



function renderHeader(username, completedTasks, attemptedTasks, totalTasks, taskSetName, isOwner) {
	const CIRC = 376.99;
	const notCompletedTasks = Math.max(attemptedTasks - completedTasks, 0);
	const notStartedTasks = Math.max(totalTasks - attemptedTasks, 0);
	const hasNotCompletedTasks = notCompletedTasks > 0;
	const hasNotStartedTasks = notStartedTasks > 0;
	const percent = totalTasks > 0
		? Math.round((completedTasks / totalTasks) * 100)
		: 0;
	const completedLen = totalTasks > 0 ? (completedTasks / totalTasks) * CIRC : 0;
	const notCompletedLen = totalTasks > 0 ? (notCompletedTasks / totalTasks) * CIRC : 0;
	const notStartedLen = totalTasks > 0 ? (notStartedTasks / totalTasks) * CIRC : 0;
	const completedDeg = totalTasks > 0 ? (completedTasks / totalTasks) * 360 - 90 : -90;
	const notCompletedDeg = totalTasks > 0 ? ((completedTasks + notCompletedTasks) / totalTasks) * 360 - 90 : -90;

	const container = document.getElementById('page-header');
	container.className = 'mb-4';
	container.innerHTML = `
	<div class="d-flex align-items-center mb-3 sa-user-row">
		<span class="badge badge-pill sa-user-badge">
			<i class="fas fa-user-graduate mr-1"></i>${escapeHtml(username)}
		</span>
		${isOwner ? `
		<button type="button" id="remove-student-btn" class="btn btn-sm sa-remove-student-btn">
			Remove student from task set
		</button>
		` : ''}
	</div>
	${taskSetName ? `<div class="sa-taskset-info"><i class="fas fa-tasks mr-2"></i><strong>Task Set:</strong> ${escapeHtml(taskSetName)}</div>` : ''}
	<p class="text-muted">All tasks in this task set and student progress</p>
	`;
	bindRemoveStudentButton();

	const completionPanel = document.getElementById('completion-panel');
	if (completionPanel) {
		const arcCompleted = document.getElementById('sa-arc-completed');
		const arcNotCompleted = document.getElementById('sa-arc-not-completed');
		const arcNotStarted = document.getElementById('sa-arc-not-started');
		const percentEl = document.getElementById('sa-donut-percent');
		const doneRatioEl = document.getElementById('sa-done-ratio');
		const completedValEl = document.getElementById('sa-value-completed');
		const notCompletedValEl = document.getElementById('sa-value-not-completed');
		const notStartedValEl = document.getElementById('sa-value-not-started');
		const notCompletedDotEl = document.getElementById('sa-dot-not-completed');
		const notStartedDotEl = document.getElementById('sa-dot-not-started');

		if (arcCompleted) {
			arcCompleted.setAttribute('stroke-dasharray', `${completedLen.toFixed(1)} ${(CIRC - completedLen).toFixed(1)}`);
		}

		if (arcNotCompleted) {
			arcNotCompleted.classList.toggle('sa-arc-not-completed', hasNotCompletedTasks);
			arcNotCompleted.classList.toggle('sa-arc-hidden', !hasNotCompletedTasks);
			arcNotCompleted.setAttribute('transform', `rotate(${completedDeg} 80 80)`);
			arcNotCompleted.setAttribute('stroke-dasharray', `${notCompletedLen.toFixed(1)} ${(CIRC - notCompletedLen).toFixed(1)}`);
		}

		if (arcNotStarted) {
			arcNotStarted.classList.toggle('sa-arc-not-started', hasNotStartedTasks);
			arcNotStarted.classList.toggle('sa-arc-hidden', !hasNotStartedTasks);
			arcNotStarted.setAttribute('transform', `rotate(${notCompletedDeg} 80 80)`);
			arcNotStarted.setAttribute('stroke-dasharray', `${notStartedLen.toFixed(1)} ${(CIRC - notStartedLen).toFixed(1)}`);
		}

		if (percentEl) percentEl.textContent = totalTasks > 0 ? `${percent}%` : '—';
		if (doneRatioEl) doneRatioEl.textContent = `${completedTasks}/${totalTasks} done`;
		if (completedValEl) completedValEl.textContent = String(completedTasks);
		if (notCompletedValEl) {
			notCompletedValEl.textContent = String(notCompletedTasks);
			notCompletedValEl.classList.toggle('sa-value-not-completed', hasNotCompletedTasks);
			notCompletedValEl.classList.toggle('sa-value-muted', !hasNotCompletedTasks);
		}
		if (notStartedValEl) {
			notStartedValEl.textContent = String(notStartedTasks);
			notStartedValEl.classList.toggle('sa-value-not-started', hasNotStartedTasks);
			notStartedValEl.classList.toggle('sa-value-muted-light', !hasNotStartedTasks);
		}
		if (notCompletedDotEl) {
			notCompletedDotEl.classList.toggle('sa-dot-not-completed', hasNotCompletedTasks);
			notCompletedDotEl.classList.toggle('sa-dot-muted', !hasNotCompletedTasks);
		}
		if (notStartedDotEl) {
			notStartedDotEl.classList.toggle('sa-dot-not-started', hasNotStartedTasks);
			notStartedDotEl.classList.toggle('sa-dot-muted', !hasNotStartedTasks);
		}
	}
}

function createAttemptItem(attempt) {
	const item = document.createElement('div');
	item.className = 'task-set-item';
	const navigate = () => {
		window.location.href = `/student-task-statistics?student_id=${encodeURIComponent(studentId)}&student=${encodeURIComponent(studentUsername || '')}&task_id=${attempt.task_id}&set_id=${setId}`;
	};
	item.onclick = navigate;
	makeKeyActivatable(item, navigate);

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = attempt.task_title;

	const meta = document.createElement('div');
	meta.className = 'task-set-meta';

	let statusIcon = '';
	let lastAttemptText = '';

	if (attempt.success_count > 0) {
		statusIcon = '<i class="fas fa-check-circle sa-icon-success"></i><span class="sa-status-label"> Success</span>';
	} else if (attempt.attempts > 0) {
		statusIcon = '<i class="fas fa-times-circle sa-icon-failed"></i><span class="sa-status-label"> Failed</span>';
	} else if (attempt.has_started) {
		statusIcon = '<i class="fas fa-clock sa-icon-in-progress" style="color:var(--amber);"></i><span class="sa-status-label" style="color:var(--amber);"> In progress</span>';
	} else {
		statusIcon = '<i class="fas fa-circle sa-icon-not-started" style="font-size: 0.75em; vertical-align: middle;"></i><span class="sa-status-label text-muted"> Not started</span>';
	}

	if (attempt.attempts > 0 && attempt.last_attempt_at) {
		lastAttemptText = `<i class="far fa-clock"></i> Last attempt: ${formatDateTime(attempt.last_attempt_at)}`;
	} else if (attempt.has_started) {
		lastAttemptText = `<i class="far fa-clock"></i> Started (no attempts yet)`;
	} else {
		lastAttemptText = `<i class="far fa-clock"></i> Not attempted yet`;
	}

	meta.innerHTML = `
	${statusIcon}
	<span class="sa-attempt-count">Total Attempts: ${attempt.attempts}</span>
	${lastAttemptText}
	`;

	item.appendChild(title);
	item.appendChild(meta);

	return item;
}

function renderAttempts(attempts) {
	const attemptsContainer = document.getElementById('attempts-container');
	const attemptsList = document.getElementById('attempts-list');

	if (attempts.length === 0) {
	attemptsList.innerHTML = `
		<div class="empty-state">
		<i class="fas fa-clipboard"></i>
		<h4>No Tasks Found</h4>
		<p>There are no tasks in this task set.</p>
		</div>
	`;
	} else {
	attemptsList.innerHTML = '';
	attempts.forEach(attempt => {
		attemptsList.appendChild(createAttemptItem(attempt));
	});
	}

	attemptsContainer.style.display = 'block';
}


// Load student attempts and full task set task count
Promise.all([
	fetch(`/api/students/${encodeURIComponent(studentId)}/attempts?set_id=${setId}`, {
		credentials: 'include'
	}),
	fetch(`/api/my_sets/${encodeURIComponent(setId)}/tasks`, {
		credentials: 'include'
	}),
	fetch(`/api/my_sets/${encodeURIComponent(setId)}`, {
		credentials: 'include'
	})
])
	.then(async ([attemptsResponse, taskSetTasksResponse, taskSetResponse]) => {
		if (!attemptsResponse.ok) {
			if (attemptsResponse.status === 401) {
				window.location.href = '/';
				return;
			}
			throw new Error('Failed to load student attempts');
		}

		const attempts = await attemptsResponse.json();
		const startedTasks = attempts.filter(attempt => attempt.has_started || attempt.attempts > 0).length;
		const completedTasks = attempts.filter(attempt => attempt.success_count > 0).length;

		let totalTasks = attempts.length;
		if (taskSetTasksResponse.ok) {
			const taskSetTasks = await taskSetTasksResponse.json();
			totalTasks = taskSetTasks.length;
		}

		let taskSetName = '';
		let ownerUsername = '';
		if (taskSetResponse.ok) {
			const taskSetData = await taskSetResponse.json();
			taskSetName = taskSetData.title || '';
			ownerUsername = taskSetData.owner_username || '';
		}

		const isOwner = localStorage.getItem('username') === ownerUsername;
		renderHeader(studentUsername, completedTasks, startedTasks, totalTasks, taskSetName, isOwner);
		renderAttempts(attempts);
	})
	.catch(err => {
	console.error('Error loading attempts:', err);
	if (err.message && err.message.includes('401')) {
		window.location.href = '/';
	} else {
		showError(err.message);
	}
	});
