import {initProtectedPage, initSignedInAs, initBurgerMenu} from '../core/auth-ui.js';
import { createPrivateBadge, isPrivateTask } from '../components/privacy-badge.js';
import { formatDate, showError, makeKeyActivatable } from '../utils/ui-utils.js';
import { createTaskSetItem } from '../utils/ui-components.js';
import { fetchJsonWithError, authFetch } from '../utils/api-utils.js';

initProtectedPage('/');
initSignedInAs();
initBurgerMenu();

function clearTaskDraftStorage() {
	[localStorage, sessionStorage].forEach((storage) => {
		Object.keys(storage)
			.filter((key) => key.startsWith('create_task_'))
			.forEach((key) => storage.removeItem(key));
	});
}

// Clear any draft states from the task creator when loading the dashboard
clearTaskDraftStorage();

// Load user info
const userNameEl = document.getElementById('user-name');
const allSetsButton = document.getElementById('all-sets-button');
let currentUsername = null;

async function loadCurrentUser() {
	try {
		const data = await fetchJsonWithError('/api/me', 'Failed to fetch user data');
		currentUsername = data?.username ?? null;
		if (data?.username) {
			userNameEl.textContent = data.username;
			localStorage.setItem('username', data.username);
		}
		if (data?.is_admin_teacher) {
			allSetsButton.style.display = 'inline-block';
		}
	} catch (error) {
		console.error(error);
		userNameEl.textContent = '';
	}
}



function formatTaskTypeLabel(taskType) {
	if (!taskType) {
		return '';
	}

	return taskType.charAt(0).toUpperCase() + taskType.slice(1);
}





function renderTaskSets(taskSets) {
	const container = document.getElementById('task-sets-container');
	container.className = '';
	container.innerHTML = '';

	const headerRow = document.createElement('div');
	headerRow.className = 'section-header-row';
	const heading = document.createElement('h4');
	heading.textContent = 'My Task Sets';
	const createBtn = document.createElement('a');
	createBtn.href = '/create-task-set';
	createBtn.className = 'section-create-btn';
	createBtn.innerHTML = '<i class="fas fa-plus"></i> New Task Set';
	headerRow.appendChild(heading);
	headerRow.appendChild(createBtn);
	container.appendChild(headerRow);

	if (taskSets.length === 0) {
		container.insertAdjacentHTML('beforeend', `
			<div class="empty-state">
			<i class="fas fa-folder-open"></i>
			<h4>No Task Sets Yet</h4>
			<p>Create your first task set to get started with organizing exercises and viewing statistics.</p>
			</div>
		`);
		return;
	}

	const searchBox = document.createElement('div');
	searchBox.className = 'search-box';
	searchBox.innerHTML = '<i class="fas fa-search"></i><input type="text" id="task-search" placeholder="Search task sets…" autocomplete="off">';
	container.appendChild(searchBox);

	const ownedLists = currentUsername
		? taskSets.filter(taskSet => taskSet.owner_username === currentUsername)
		: taskSets;
	const sharedLists = currentUsername
		? taskSets.filter(taskSet => taskSet.owner_username !== currentUsername)
		: [];

	const ownedSection = document.createElement('div');
	ownedSection.className = 'task-set-section';

	const ownedContainer = document.createElement('div');
	if (ownedLists.length === 0) {
		ownedContainer.innerHTML = '<div class="text-muted mb-3">No task sets yet.</div>';
	} else {
		ownedLists.forEach(taskSet => {
			ownedContainer.appendChild(createTaskSetItem(taskSet, currentUsername));
		});
	}
	ownedSection.appendChild(ownedContainer);

	const sharedSection = document.createElement('div');
	sharedSection.className = 'task-set-section mt-4';
	sharedSection.innerHTML = '<h4 class="mb-3">Shared With You</h4>';

	const sharedContainer = document.createElement('div');
	if (sharedLists.length === 0) {
		sharedContainer.innerHTML = '<div class="text-muted">No shared task sets.</div>';
	} else {
		sharedLists.forEach(taskSet => {
			sharedContainer.appendChild(createTaskSetItem(taskSet, currentUsername));
		});
	}
	sharedSection.appendChild(sharedContainer);

	container.appendChild(ownedSection);
	container.appendChild(sharedSection);
	setupSearch();
}

function setupSearch() {
	const input = document.getElementById('task-search');
	if (!input) return;
	const taskSetsContainer = document.getElementById('task-sets-container');
	input.addEventListener('input', () => {
		const q = input.value.trim().toLowerCase();
		let totalVisible = 0;
		taskSetsContainer.querySelectorAll('.task-set-section').forEach(section => {
			const items = section.querySelectorAll('.task-set-item');
			let sectionVisible = 0;
			items.forEach(item => {
				const title = item.querySelector('.task-set-title')?.textContent.toLowerCase() ?? '';
				const code = item.querySelector('.task-set-code-chip')?.textContent.toLowerCase() ?? '';
				const match = !q || title.includes(q) || code.includes(q);
				item.style.display = match ? '' : 'none';
				if (match) sectionVisible++;
			});
			const heading = section.querySelector('h4');
			if (heading) heading.style.display = sectionVisible === 0 && q ? 'none' : '';
			totalVisible += sectionVisible;
		});
		let noResults = document.getElementById('search-no-results');
		if (q && totalVisible === 0) {
			if (!noResults) {
				noResults = document.createElement('div');
				noResults.id = 'search-no-results';
				noResults.className = 'search-no-results';
				noResults.textContent = 'No task sets match your search.';
				taskSetsContainer.appendChild(noResults);
			}
		} else if (noResults) {
			noResults.remove();
		}
	});
}





async function loadTaskSets() {
	try {
		const data = await fetchJsonWithError('/api/my_sets', 'Failed to load task sets');
		renderTaskSets(data);
	} catch (err) {
		console.error('Error loading task sets:', err);
		showError(err.message);
	}
}

function createMyTaskCard(task) {
	const card = document.createElement('div');
	card.className = 'task-set-item';
	card.style.cursor = 'pointer';
	const openDetails = () => {
		window.location.href = `/task-details?id=${task.id}`;
	};
	card.onclick = openDetails;
	makeKeyActivatable(card, openDetails);

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
	meta.textContent = `${formatTaskTypeLabel(task.task_type)} · Created ${formatDate(task.created_at)}`;
	card.appendChild(meta);

	const actions = document.createElement('div');
	actions.className = 'd-flex flex-wrap mt-2';
	actions.style.gap = '0.5rem';
	actions.addEventListener('click', (e) => e.stopPropagation());

	if (task.editable) {
		const editBtn = document.createElement('a');
		editBtn.href = `/create-task-editor?task_id=${task.id}`;
		editBtn.className = 'btn btn-sm btn-outline-success action-btn';
		editBtn.innerHTML = '<i class="fas fa-pen"></i> Edit';
		actions.appendChild(editBtn);

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'btn btn-sm btn-outline-danger';
		deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
		deleteBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
			try {
				await authFetch(`/api/problems/${task.id}`, { method: 'DELETE' });
				loadMyTasks(); // refresh the list
			} catch (err) {
				console.error('Delete failed:', err);
				alert(err.message || 'Failed to delete task.');
			}
		});
		actions.appendChild(deleteBtn);
	} else {
		const lockedSpan = document.createElement('span');
		lockedSpan.className = 'btn btn-sm btn-secondary disabled';
		lockedSpan.title = 'This task is in use and cannot be edited or deleted';
		lockedSpan.innerHTML = '<i class="fas fa-lock"></i> In use';
		actions.appendChild(lockedSpan);
	}

	const statsBtn = document.createElement('a');
	statsBtn.href = `/task-statistics?id=${task.id}`;
	statsBtn.className = 'btn btn-sm btn-outline-primary action-btn';
	statsBtn.innerHTML = '<i class="fas fa-chart-line"></i>Global Statistics';
	actions.appendChild(statsBtn);

	card.appendChild(actions);
	return card;
}

function renderMyTasks(tasks) {
	const container = document.getElementById('your-tasks-container');
	if (!container) return;

	container.innerHTML = '';
	const section = document.createElement('div');
	section.className = 'task-set-section';

	const sectionHeader = document.createElement('div');
	sectionHeader.className = 'section-header-row';

	const heading = document.createElement('h4');
	heading.textContent = 'My Tasks';

	const createBtn = document.createElement('a');
	createBtn.href = '/create-task';
	createBtn.className = 'section-create-btn';
	createBtn.innerHTML = '<i class="fas fa-plus"></i> New Task';
	createBtn.addEventListener('click', clearTaskDraftStorage);

	sectionHeader.appendChild(heading);
	sectionHeader.appendChild(createBtn);

	section.appendChild(sectionHeader);

	const searchBox = document.createElement('div');
	searchBox.className = 'search-box';
	searchBox.innerHTML = '<i class="fas fa-search"></i><input type="text" id="task-item-search" placeholder="Search tasks…" autocomplete="off">';
	section.appendChild(searchBox);

	if (tasks.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'text-muted mb-0';
		empty.textContent = 'No tasks created yet.';
		section.appendChild(empty);
	} else {
		tasks.forEach((task) => section.appendChild(createMyTaskCard(task)));
	}

	container.appendChild(section);
	setupTaskSearch();
}

function setupTaskSearch() {
	const input = document.getElementById('task-item-search');
	if (!input) return;
	const tasksContainer = document.getElementById('your-tasks-container');
	input.addEventListener('input', () => {
		const q = input.value.trim().toLowerCase();
		let visible = 0;
		tasksContainer.querySelectorAll('.task-set-item').forEach(item => {
			const title = item.querySelector('.task-set-title')?.textContent.toLowerCase() ?? '';
			const meta = item.querySelector('.task-set-meta')?.textContent.toLowerCase() ?? '';
			const match = !q || title.includes(q) || meta.includes(q);
			item.style.display = match ? '' : 'none';
			if (match) visible++;
		});
		let noResults = document.getElementById('task-search-no-results');
		if (q && visible === 0) {
			if (!noResults) {
				noResults = document.createElement('div');
				noResults.id = 'task-search-no-results';
				noResults.className = 'search-no-results';
				noResults.textContent = 'No tasks match your search.';
				tasksContainer.appendChild(noResults);
			}
		} else if (noResults) {
			noResults.remove();
		}
	});
}

async function loadMyTasks() {
	try {
		const data = await fetchJsonWithError('/api/my_tasks', 'Failed to load tasks');
		renderMyTasks(data);
	} catch (err) {
		console.error('Error loading tasks:', err);
	}
}

async function initPage() {
	await loadCurrentUser();
	await Promise.all([loadTaskSets(), loadMyTasks()]);
}

initPage();
