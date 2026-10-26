import {initProtectedPage, initSignedInAs, initBurgerMenu} from '../core/auth-ui.js';
import {createPrivateBadge, isPrivateTask} from '../components/privacy-badge.js';
import { formatDate, escapeHtml, makeKeyActivatable } from '../utils/ui-utils.js';
import { createTaskSetItem } from '../utils/ui-components.js';
import { deleteUser, makeAdmin, resetUserPassword, setupCopyButton } from './admin-user-actions.js';

initProtectedPage('/');
initSignedInAs();
initBurgerMenu();

setupCopyButton('copy-username-btn', () => document.getElementById('overview-username')?.textContent?.trim());
setupCopyButton('copy-email-btn', () => document.getElementById('overview-email')?.textContent?.trim());

const urlParams = new URLSearchParams(window.location.search);
const teacherId = parseInt(urlParams.get('teacher_id'), 10);

if (isNaN(teacherId)) {
	alert('Invalid Teacher ID');
	window.location.href = '/all-users';
}




// Dom elements
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

let teacherSets = [];
let teacherTasks = [];



function createTaskItem(task) {
	const card = document.createElement('div');
	card.className = 'task-set-item';
	card.style.cursor = 'pointer';
	const openPreview = () => {
		window.location.href = '/task-details?id=' + encodeURIComponent(task.id);
	};
	card.onclick = openPreview;
	makeKeyActivatable(card, openPreview);

	const header = document.createElement('div');
	header.className = 'task-set-item-top';

	const titleWrap = document.createElement('div');
	titleWrap.style.display = 'flex';
	titleWrap.style.alignItems = 'center';
	titleWrap.style.gap = '.45rem';
	titleWrap.style.minWidth = '0';

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = task.title;
	titleWrap.appendChild(title);

	if (isPrivateTask(task)) {
		titleWrap.appendChild(createPrivateBadge());
	}

	header.appendChild(titleWrap);
	card.appendChild(header);

	const meta = document.createElement('div');
	meta.className = 'task-set-meta';
	meta.innerHTML = `
		<div style="margin-bottom: 0.2rem;"><i class="fas fa-code-branch"></i> Type: ${task.task_type}</div>
		<div><i class="far fa-calendar-alt"></i> Created: ${formatDate(task.created_at)}</div>
	`;
	card.appendChild(meta);

	if (task.description) {
		const description = document.createElement('div');
		description.className = 'task-set-description';
		description.textContent = task.description;
		card.appendChild(description);
	}

	return card;
}

function renderTaskSets() {
	setsContainer.className = '';
	setsContainer.innerHTML = '';

	const query = setsSearchInput.value.trim().toLowerCase();
	const filtered = teacherSets.filter(ts => {
		const title = (ts.title || '').toLowerCase();
		const code = (ts.unique_link_code || '').toLowerCase();
		return !query || title.includes(query) || code.includes(query);
	});

	if (filtered.length === 0) {
		setsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No matching task sets.</p></div>';
		return;
	}

	filtered.forEach(ts => {
		setsContainer.appendChild(createTaskSetItem(ts));
	});
}

function renderTasks() {
	tasksContainer.className = '';
	tasksContainer.innerHTML = '';

	const query = tasksSearchInput.value.trim().toLowerCase();
	const filtered = teacherTasks.filter(t => {
		const title = (t.title || '').toLowerCase();
		const type = (t.task_type || '').toLowerCase();
		return !query || title.includes(query) || type.includes(query);
	});

	if (filtered.length === 0) {
		tasksContainer.innerHTML = '<div class="empty-state"><i class="fas fa-tasks"></i><p>No matching tasks.</p></div>';
		return;
	}

	filtered.forEach(t => {
		tasksContainer.appendChild(createTaskItem(t));
	});
}

async function loadData() {
	try {
		// 1. Fetch users, all tasksets, and tasks
		const [allUsers, allSets, allTasks] = await Promise.all([
			fetchJsonWithError('/api/admin/users', 'Failed to load users'),
			fetchJsonWithError('/api/all-tasksets', 'Failed to load task sets'),
			fetchJsonWithError('/api/tasks', 'Failed to load tasks'),
		]);

		// 2. Find teacher details
		const teacher = allUsers.find(u => u.role === 'teacher' && u.id === teacherId);
		if (!teacher) {
			throw new Error('Teacher user not found.');
		}

		// 3. Populate Overview
		pageTitle.textContent = `Teacher Profile: ${teacher.username}`;
		overviewUsername.textContent = teacher.username;
		overviewEmail.textContent = teacher.email;
		overviewId.textContent = teacher.id;
		overviewRegistered.textContent = formatDate(teacher.created_at);

		// 4. Filter lists by teacher
		teacherSets = allSets.filter(ts => ts.owner_username === teacher.username || ts.teacher_id === teacher.id);
		teacherTasks = allTasks.filter(t => t.creator_username === teacher.username || t.created_by_teacher_id === teacher.id);

		// Update overview counts
		overviewSetsCount.textContent = `${teacherSets.length} task set${teacherSets.length !== 1 ? 's' : ''}`;
		overviewTasksCount.textContent = `${teacherTasks.length} task${teacherTasks.length !== 1 ? 's' : ''}`;

		// 5. Render lists
		renderTaskSets();
		renderTasks();

		// 6. Populate Actions Row
		const actionsRow = document.getElementById('user-actions-row');
		const actionsContainer = document.getElementById('user-actions-container');
		if (actionsRow && actionsContainer) {
			actionsContainer.innerHTML = '';

			if (!teacher.is_admin_teacher && !teacher.is_current_user && teacher.id !== 999999) {
				const makeAdminBtn = document.createElement('button');
				makeAdminBtn.className = 'btn btn-sm btn-outline-success';
				makeAdminBtn.innerHTML = '<i class="fas fa-user-shield"></i> Make Admin';
				makeAdminBtn.addEventListener('click', () => {
					makeAdmin(teacher.id, teacher.username, () => {
						teacher.is_admin_teacher = true;
						loadData();
					});
				});
				actionsContainer.appendChild(makeAdminBtn);
			}

			if (teacher.id !== 999999 && (!teacher.is_admin_teacher || teacher.is_current_user)) {
				const resetPwdBtn = document.createElement('button');
				resetPwdBtn.className = 'btn btn-sm btn-outline-info';
				resetPwdBtn.innerHTML = '<i class="fas fa-key"></i> Reset Password';
				resetPwdBtn.addEventListener('click', () => {
					resetUserPassword('teacher', teacher.id, teacher.username);
				});
				actionsContainer.appendChild(resetPwdBtn);
			}

			if (!teacher.is_admin_teacher && !teacher.is_current_user && teacher.id !== 999999) {
				const deleteBtn = document.createElement('button');
				deleteBtn.className = 'btn btn-sm btn-outline-danger';
				deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Delete Account';
				deleteBtn.addEventListener('click', () => {
					deleteUser('teacher', teacher.id, teacher.username, () => {
						window.location.href = '/all-users';
					});
				});
				actionsContainer.appendChild(deleteBtn);
			}

			if (actionsContainer.children.length > 0) {
				actionsRow.style.display = 'flex';
			} else {
				actionsRow.style.display = 'none';
			}
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
import { fetchJsonWithError } from '../utils/api-utils.js';
