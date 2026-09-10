import {initProtectedPage, initSignedInAs, initBurgerMenu} from '../core/auth-ui.js';
import { formatDate, escapeHtml } from '../utils/ui-utils.js';
import { deleteUser, resetUserPassword, setupCopyButton } from './admin-user-actions.js';

initProtectedPage('/');
initSignedInAs();
initBurgerMenu();

setupCopyButton('copy-username-btn', () => document.getElementById('overview-username')?.textContent?.trim());
setupCopyButton('copy-email-btn', () => document.getElementById('overview-email')?.textContent?.trim());

const urlParams = new URLSearchParams(window.location.search);
const studentId = parseInt(urlParams.get('student_id'), 10);

if (isNaN(studentId)) {
	alert('Invalid Student ID');
	window.location.href = '/all-users';
}


function makeKeyActivatable(el, handler) {
	el.setAttribute('tabindex', '0');
	el.setAttribute('role', 'button');
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handler(e);
		}
	});
}

// DOM elements
const overviewUsername = document.getElementById('overview-username');
const overviewEmail = document.getElementById('overview-email');
const overviewId = document.getElementById('overview-id');
const overviewRegistered = document.getElementById('overview-registered');
const overviewSetsCount = document.getElementById('overview-sets-count');
const overviewTasksCount = document.getElementById('overview-tasks-count');
const pageTitle = document.getElementById('page-title');

const setsContainer = document.getElementById('task-sets-list-container');
const tasksContainer = document.getElementById('tasks-list-container');

const setsSearchInput = document.getElementById('sets-search');
const tasksSearchInput = document.getElementById('tasks-search');

let studentSets = [];
let studentTasks = [];
let studentUsername = '';

function createEnrolledTaskSetItem(taskSet) {
	const item = document.createElement('div');
	item.className = 'task-set-item';
	const navigateToSet = () => { window.location.href = `/task-set-overview?set_id=${taskSet.id}`; };
	item.onclick = navigateToSet;
	makeKeyActivatable(item, navigateToSet);

	// Top row: title + join code chip
	const topRow = document.createElement('div');
	topRow.className = 'task-set-item-top';

	const titleWrap = document.createElement('div');
	titleWrap.style.display = 'flex';
	titleWrap.style.alignItems = 'center';
	titleWrap.style.gap = '.45rem';
	titleWrap.style.minWidth = '0';

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = taskSet.title;
	titleWrap.appendChild(title);

	topRow.appendChild(titleWrap);

	if (taskSet.unique_link_code) {
		const chip = document.createElement('div');
		chip.className = 'task-set-code-chip';
		chip.title = 'Click to copy link';
		chip.innerHTML = `<i class="far fa-copy"></i>${taskSet.unique_link_code}`;
		const copyLink = (e) => {
			e.stopPropagation();
			const url = `${window.location.protocol}//${window.location.host}/${encodeURIComponent(taskSet.teacher_username || '')}/set/${encodeURIComponent(taskSet.unique_link_code)}`;
			navigator.clipboard.writeText(url).then(() => {
				chip.classList.add('copied');
				chip.innerHTML = `<i class="fas fa-check"></i>${taskSet.unique_link_code}`;
				setTimeout(() => {
					chip.classList.remove('copied');
					chip.innerHTML = `<i class="far fa-copy"></i>${taskSet.unique_link_code}`;
				}, 1500);
			});
		};
		chip.onclick = copyLink;
		makeKeyActivatable(chip, copyLink);
		topRow.appendChild(chip);
	}

	item.appendChild(topRow);

	const meta = document.createElement('div');
	meta.className = 'task-set-meta';
	meta.innerHTML = `
		<div style="margin-bottom: 0.2rem;"><i class="far fa-calendar"></i> Joined ${formatDate(taskSet.enrolled_at)}</div>
		<div style="margin-bottom: 0.2rem;"><i class="fas fa-chalkboard-teacher"></i> Teacher: ${escapeHtml(taskSet.teacher_username)}</div>
		<div><i class="fas fa-tasks"></i> ${taskSet.completed_tasks} / ${taskSet.total_tasks} task${taskSet.total_tasks !== 1 ? 's' : ''} completed</div>
	`;
	item.appendChild(meta);

	return item;
}

function createTaskAttemptItem(task) {
	const card = document.createElement('div');
	card.className = 'task-set-item';
	card.style.cursor = 'pointer';
	const openStats = () => {
		window.location.href = `/student-task-statistics?student_id=${encodeURIComponent(studentId)}&student=${encodeURIComponent(studentUsername)}&task_id=${task.task_id}&set_id=${task.task_set_id}`;
	};
	card.onclick = openStats;
	makeKeyActivatable(card, openStats);

	const header = document.createElement('div');
	header.className = 'task-set-item-top';

	const titleWrap = document.createElement('div');
	titleWrap.style.display = 'flex';
	titleWrap.style.alignItems = 'center';
	titleWrap.style.gap = '.45rem';
	titleWrap.style.minWidth = '0';

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = task.task_title;
	titleWrap.appendChild(title);

	header.appendChild(titleWrap);

	// Success badge
	const badge = document.createElement('span');
	badge.style.fontSize = '0.75rem';
	badge.style.padding = '0.2rem 0.5rem';
	badge.style.borderRadius = '4px';
	badge.style.fontWeight = 'bold';
	if (task.success) {
		badge.style.backgroundColor = 'var(--green-light)';
		badge.style.color = 'var(--green)';
		badge.innerHTML = '<i class="fas fa-check mr-1"></i>Completed';
	} else {
		badge.style.backgroundColor = 'var(--amber-light)';
		badge.style.color = 'var(--amber)';
		badge.innerHTML = '<i class="fas fa-hourglass-half mr-1"></i>Incomplete';
	}
	header.appendChild(badge);

	card.appendChild(header);

	const meta = document.createElement('div');
	meta.className = 'task-set-meta';
	const attemptsText = task.attempts === 0 ? 'No attempts yet' : `${task.attempts} attempt${task.attempts !== 1 ? 's' : ''}`;
	const lastAttemptText = task.last_attempt_at ? `<div style="margin-bottom: 0.2rem;"><i class="far fa-clock"></i> Last attempt: ${formatDate(task.last_attempt_at)}</div>` : '';
	meta.innerHTML = `
		<div style="margin-bottom: 0.2rem;"><i class="fas fa-code-branch"></i> ${task.task_type}</div>
		<div style="margin-bottom: 0.2rem;"><i class="fas fa-folder"></i> Set: ${escapeHtml(task.task_set_title)}</div>
		<div style="margin-bottom: 0.2rem;"><i class="fas fa-history"></i> ${attemptsText}</div>
		${lastAttemptText}
	`;
	card.appendChild(meta);

	return card;
}

function renderTaskSets() {
	setsContainer.className = '';
	setsContainer.innerHTML = '';

	const query = setsSearchInput.value.trim().toLowerCase();
	const filtered = studentSets.filter(ts => {
		const title = (ts.title || '').toLowerCase();
		const code = (ts.unique_link_code || '').toLowerCase();
		return !query || title.includes(query) || code.includes(query);
	});

	if (filtered.length === 0) {
		setsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No matching task sets.</p></div>';
		return;
	}

	filtered.forEach(ts => {
		setsContainer.appendChild(createEnrolledTaskSetItem(ts));
	});
}

function renderTasks() {
	tasksContainer.className = '';
	tasksContainer.innerHTML = '';

	const query = tasksSearchInput.value.trim().toLowerCase();
	const filtered = studentTasks.filter(t => {
		const title = (t.task_title || '').toLowerCase();
		const type = (t.task_type || '').toLowerCase();
		const set = (t.task_set_title || '').toLowerCase();
		return !query || title.includes(query) || type.includes(query) || set.includes(query);
	});

	if (filtered.length === 0) {
		tasksContainer.innerHTML = '<div class="empty-state"><i class="fas fa-tasks"></i><p>No matching tasks.</p></div>';
		return;
	}

	filtered.forEach(t => {
		tasksContainer.appendChild(createTaskAttemptItem(t));
	});
}

async function loadData() {
	try {
		const response = await fetch(`/api/admin/students/${studentId}`, { credentials: 'include' });
		if (!response.ok) {
			throw new Error('Failed to load student details.');
		}

		const data = await response.json();
		const student = data.student;
		studentUsername = student.username;

		// Populate Overview
		pageTitle.textContent = `Student Profile: ${student.username}`;
		overviewUsername.textContent = student.username;
		overviewEmail.textContent = student.email;
		overviewId.textContent = student.id;
		overviewRegistered.textContent = formatDate(student.created_at);

		studentSets = data.task_sets || [];
		studentTasks = data.task_attempts || [];

		overviewSetsCount.textContent = `${studentSets.length} task set${studentSets.length !== 1 ? 's' : ''}`;

		// Total unique tasks attempted / total completed
		const completedCount = studentTasks.filter(t => t.success).length;
		overviewTasksCount.textContent = `${completedCount} / ${studentTasks.length} completed`;

		// Render lists
		renderTaskSets();
		renderTasks();

		// Populate Actions Row
		const actionsRow = document.getElementById('user-actions-row');
		const actionsContainer = document.getElementById('user-actions-container');
		if (actionsRow && actionsContainer) {
			actionsContainer.innerHTML = '';

			const resetPwdBtn = document.createElement('button');
			resetPwdBtn.className = 'btn btn-sm btn-outline-info';
			resetPwdBtn.innerHTML = '<i class="fas fa-key"></i> Reset Password';
			resetPwdBtn.addEventListener('click', () => {
				resetUserPassword('student', student.id, student.username);
			});
			actionsContainer.appendChild(resetPwdBtn);

			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'btn btn-sm btn-outline-danger';
			deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Delete Account';
			deleteBtn.addEventListener('click', () => {
				deleteUser('student', student.id, student.username, () => {
					window.location.href = '/all-users';
				});
			});
			actionsContainer.appendChild(deleteBtn);

			actionsRow.style.display = 'flex';
		}

	} catch (err) {
		console.error(err);
		setsContainer.innerHTML = `<p class="text-danger p-3">Error: ${escapeHtml(err.message)}</p>`;
		tasksContainer.innerHTML = `<p class="text-danger p-3">Error: ${escapeHtml(err.message)}</p>`;
	}
}

// Search Listeners
setsSearchInput.addEventListener('input', renderTaskSets);
tasksSearchInput.addEventListener('input', renderTasks);

loadData();
