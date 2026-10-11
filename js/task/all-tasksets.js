import {initProtectedPage, initSignedInAs, initBurgerMenu} from '../core/auth-ui.js';
import { formatDate, formatDateTimeWithoutSeconds, escapeHtml, showError } from '../utils/ui-utils.js';
import { getTaskSetOpeningStatus } from '../utils/task-set-status.js';

initProtectedPage('/');
initSignedInAs();
initBurgerMenu();

const userNameEl = document.getElementById('user-name');
const storedUsername = localStorage.getItem('username');
if (storedUsername) {
	userNameEl.textContent = storedUsername;
} else {
	fetch('/api/me', { credentials: 'include' })
	.then(r => r.ok ? r.json() : Promise.reject())
	.then(data => {
		if (data?.username) {
		userNameEl.textContent = data.username;
		localStorage.setItem('username', data.username);
		}
	})
	.catch(() => { userNameEl.textContent = ''; });
}

const filterToggleBtn = document.getElementById('task-filter-toggle');
const filterPanel = document.getElementById('task-filter-panel');
const taskSearchInput = document.getElementById('task-search');
const scopeCheckboxes = document.querySelectorAll('.filter-scope');
const countBadge = document.getElementById('task-set-count-badge');

let allTaskSets = [];

const activeFilters = {
	query: '',
	activeScope: null,
};


// ==================== Task Sets ====================

function createTaskSetItem(taskSet) {
	const item = document.createElement('div');
	item.className = 'task-set-item';
	item.onclick = () => {
	window.location.href = `/task-set-overview?set_id=${taskSet.id}`;
	};

	const left = document.createElement('div');
	left.className = 'task-set-item-left';

	const openingStatus = getTaskSetOpeningStatus(taskSet);
	const isExpired = openingStatus.status === 'expired';

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = taskSet.title;

	const code = document.createElement('div');
	code.className = 'mb-2';
	const codeSpan = document.createElement('span');
	codeSpan.className = 'task-set-code-chip';
	codeSpan.textContent = taskSet.unique_link_code;
	code.appendChild(codeSpan);

	let expiryHtml = '';
	if (taskSet.expires_at) {
		expiryHtml = isExpired
			? `<br><span class="text-danger font-weight-bold"><i class="fas fa-exclamation-circle"></i> Expired ${formatDate(taskSet.expires_at)}</span>`
			: `<br><i class="far fa-clock"></i> Expires ${formatDate(taskSet.expires_at)}`;
	}

	const openingDate = openingStatus.date
		? ` ${formatDateTimeWithoutSeconds(openingStatus.date)}`
		: '';
	const openingHtml = openingStatus.status === 'expired'
		? ''
		: `<br><span${openingStatus.status === 'open' ? ' class="task-set-opening-active"' : ''}><i class="far fa-calendar-alt"></i> ${openingStatus.label}${openingDate}</span>`;

	const meta = document.createElement('div');
	meta.className = 'task-set-meta';
	meta.innerHTML = `
	<i class="far fa-user"></i> Made by ${escapeHtml(taskSet.owner_username ?? String(taskSet.teacher_id))}<br>
	<i class="fas fa-tasks"></i> ${taskSet.task_count} task${taskSet.task_count !== 1 ? 's' : ''}<br>
	<i class="fas fa-user-graduate"></i> ${taskSet.student_count} student${taskSet.student_count !== 1 ? 's' : ''} joined<br>
	<i class="far fa-calendar"></i> Created ${formatDate(taskSet.created_at)}
	${openingHtml}
	${expiryHtml}
	`;

	left.appendChild(title);
	left.appendChild(code);
	left.appendChild(meta);

	const right = document.createElement('div');
	right.className = 'task-set-item-right';

	if (taskSet.student_description) {
		const studentDesc = document.createElement('div');
		studentDesc.className = 'student-instructions-box';
		studentDesc.innerHTML = `<strong style="font-weight: 700; font-size: 0.78rem; display: block; margin-bottom: 0.2rem; color: #0284c7;"><i class="fas fa-info-circle"></i> Student Instructions</strong>${escapeHtml(taskSet.student_description)}`;
		right.appendChild(studentDesc);
	}

	if (taskSet.teacher_description) {
		const teacherDesc = document.createElement('div');
		teacherDesc.className = 'teacher-notes-box';
		teacherDesc.innerHTML = `<strong style="font-weight: 700; font-size: 0.78rem; display: block; margin-bottom: 0.2rem; color: var(--brand-text);"><i class="fas fa-chalkboard-teacher"></i> Teacher Notes</strong>${escapeHtml(taskSet.teacher_description)}`;
		right.appendChild(teacherDesc);
	}

	item.appendChild(left);
	if (right.hasChildNodes()) item.appendChild(right);

	return item;
}

function updateCountBadge(count) {
	if (!countBadge) return;
	countBadge.textContent = count + (count === 1 ? ' task set' : ' task sets');
	countBadge.style.display = '';
}

function renderTaskSets(taskSets) {
	const container = document.getElementById('task-sets-container');
	container.className = '';
	container.innerHTML = '';
	updateCountBadge(taskSets.length);

	if (taskSets.length === 0) {
		container.innerHTML = `
			<div class="empty-state">
			<i class="fas fa-folder-open"></i>
			<h4>No Task Sets Found</h4>
			<p>There are no task sets matching your search.</p>
			</div>
		`;
	} else {
		const listsColumn = document.createElement('div');
		listsColumn.className = 'task-sets-column';
		taskSets.forEach(taskSet => listsColumn.appendChild(createTaskSetItem(taskSet)));
		container.appendChild(listsColumn);
	}
}

function applyFilters() {
	const query = activeFilters.query;
	const scope = activeFilters.activeScope;

	const filtered = allTaskSets.filter(ts => {
		const title = (ts.title || '').toLowerCase();
		const teacher = (ts.owner_username || '').toLowerCase();

		if (!query) return true;

		if (!scope) return title.includes(query) || teacher.includes(query);
		if (scope === 'title') return title.includes(query);
		if (scope === 'teacher') return teacher.includes(query);
		return false;
	});

	renderTaskSets(filtered);
}

function setupFilterUi() {
	if (filterToggleBtn) {
		filterToggleBtn.addEventListener('click', () => {
			const isExpanded = filterPanel.classList.contains('show');
			filterPanel.classList.toggle('show', !isExpanded);
			filterToggleBtn.setAttribute('aria-expanded', String(!isExpanded));
		});
	}

	if (taskSearchInput) {
		taskSearchInput.addEventListener('input', e => {
			activeFilters.query = e.target.value.trim().toLowerCase();
			applyFilters();
		});
	}

	scopeCheckboxes.forEach(checkbox => {
		checkbox.addEventListener('change', e => {
			if (e.target.checked) {
				scopeCheckboxes.forEach(other => { if (other !== e.target) other.checked = false; });
				activeFilters.activeScope = e.target.value;
			} else {
				activeFilters.activeScope = null;
			}
			applyFilters();
		});
	});
}


// ==================== Page Initialization ====================

setupFilterUi();

fetch('/api/all-tasksets', { credentials: 'include' })
	.then(r => {
		if (!r.ok) {
			if (r.status === 401 || r.status === 403) {
				window.location.href = '/';
				return;
			}
			throw new Error('Failed to load task sets');
		}
		return r.json();
	})
	.then(data => {
		if (data) {
			allTaskSets = data;
			applyFilters();
		}
	})
	.catch(err => {
		console.error('Error loading task sets:', err);
		showError(err.message);
	});
