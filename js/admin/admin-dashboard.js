import {initProtectedPage, initSignedInAs, initBurgerMenu} from '../core/auth-ui.js';
import { formatDate } from '../utils/ui-utils.js';

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


// ==================== Statistics ====================

function createChart(canvasId, dailyData, barColor = '#007bff') {
	const canvas = document.getElementById(canvasId);
	if (!canvas) return;

	const ctx = canvas.getContext('2d');
	const width = canvas.width;
	const height = canvas.height;

	if (dailyData.length === 0) {
		ctx.fillStyle = '#ccc';
		ctx.font = '14px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('No data available', width / 2, height / 2);
		return;
	}

	const maxValue = Math.max(...dailyData.map(d => d.active_users), 1);
	const paddingLeft = 50;
	const paddingRight = 20;
	const paddingBottom = 50;
	const paddingTop = 20;
	const chartWidth = width - paddingLeft - paddingRight;
	const chartHeight = height - paddingBottom - paddingTop;

	const slotWidth = chartWidth / dailyData.length;
	const barWidth = Math.min(slotWidth * 0.7, 50);

	// Clear canvas
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, width, height);

	// Draw grid lines
	ctx.strokeStyle = '#f0f0f0';
	ctx.lineWidth = 1;
	const gridLines = 5;
	for (let i = 0; i <= gridLines; i++) {
		const y = paddingTop + (i / gridLines) * chartHeight;
		ctx.beginPath();
		ctx.moveTo(paddingLeft, y);
		ctx.lineTo(width - paddingRight, y);
		ctx.stroke();
	}

	// Draw axes
	ctx.strokeStyle = '#333';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(paddingLeft, paddingTop);
	ctx.lineTo(paddingLeft, height - paddingBottom);
	ctx.lineTo(width - paddingRight, height - paddingBottom);
	ctx.stroke();

	// Draw bars
	dailyData.forEach((d, i) => {
		const barHeight = (d.active_users / maxValue) * chartHeight;
		const x = paddingLeft + i * slotWidth + (slotWidth - barWidth) / 2;
		const y = height - paddingBottom - barHeight;

		// Draw bar
		ctx.fillStyle = barColor;
		ctx.fillRect(x, y, barWidth, barHeight);

		// Draw border
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
		ctx.lineWidth = 1;
		ctx.strokeRect(x, y, barWidth, barHeight);

		// Draw value on bar
		ctx.fillStyle = '#333';
		ctx.font = 'bold 12px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(d.active_users.toString(), x + barWidth / 2, y - 5);
	});

	// Draw date labels
	ctx.fillStyle = '#666';
	ctx.font = '11px sans-serif';
	ctx.textAlign = 'center';

	dailyData.forEach((d, i) => {
		const x = paddingLeft + i * slotWidth + slotWidth / 2;
		const dateObj = new Date(d.date);
		const label = dateObj.getDate();
		ctx.fillText(label.toString(), x, height - paddingBottom + 20);
	});

	// Draw y-axis labels
	ctx.fillStyle = '#888';
	ctx.font = '10px sans-serif';
	ctx.textAlign = 'right';
	for (let i = 0; i <= gridLines; i++) {
		const value = Math.round((i / gridLines) * maxValue);
		const y = height - paddingBottom - (i / gridLines) * chartHeight;
		ctx.fillText(value.toString(), paddingLeft - 10, y + 4);
	}
}

function createMonthlyChart(canvasId, monthlyData, barColor = '#007bff') {
	const canvas = document.getElementById(canvasId);
	if (!canvas) return;

	const ctx = canvas.getContext('2d');
	const width = canvas.width;
	const height = canvas.height;

	// Show only last 6 months
	const data = monthlyData.slice(0, 6).reverse();

	if (data.length === 0) {
		ctx.fillStyle = '#ccc';
		ctx.font = '14px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('No data available', width / 2, height / 2);
		return;
	}

	const maxValue = Math.max(...data.map(d => d.active_users), 1);
	const paddingLeft = 50;
	const paddingRight = 20;
	const paddingBottom = 50;
	const paddingTop = 20;
	const chartWidth = width - paddingLeft - paddingRight;
	const chartHeight = height - paddingBottom - paddingTop;

	const slotWidth = chartWidth / data.length;
	const barWidth = Math.min(slotWidth * 0.7, 50);

	// Clear canvas
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, width, height);

	// Draw grid lines
	ctx.strokeStyle = '#f0f0f0';
	ctx.lineWidth = 1;
	const gridLines = 5;
	for (let i = 0; i <= gridLines; i++) {
		const y = paddingTop + (i / gridLines) * chartHeight;
		ctx.beginPath();
		ctx.moveTo(paddingLeft, y);
		ctx.lineTo(width - paddingRight, y);
		ctx.stroke();
	}

	// Draw axes
	ctx.strokeStyle = '#333';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(paddingLeft, paddingTop);
	ctx.lineTo(paddingLeft, height - paddingBottom);
	ctx.lineTo(width - paddingRight, height - paddingBottom);
	ctx.stroke();

	// Draw bars
	data.forEach((d, i) => {
		const barHeight = (d.active_users / maxValue) * chartHeight;
		const x = paddingLeft + i * slotWidth + (slotWidth - barWidth) / 2;
		const y = height - paddingBottom - barHeight;

		// Draw bar
		ctx.fillStyle = barColor;
		ctx.fillRect(x, y, barWidth, barHeight);

		// Draw border
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
		ctx.lineWidth = 1;
		ctx.strokeRect(x, y, barWidth, barHeight);

		// Draw value on bar
		ctx.fillStyle = '#333';
		ctx.font = 'bold 12px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(d.active_users.toString(), x + barWidth / 2, y - 5);
	});

	// Draw month labels
	ctx.fillStyle = '#666';
	ctx.font = '10px sans-serif';
	ctx.textAlign = 'center';

	data.forEach((d, i) => {
		const x = paddingLeft + i * slotWidth + slotWidth / 2;
		const monthLabel = d.month.substring(5); // Get MM from YYYY-MM
		ctx.fillText(monthLabel, x, height - paddingBottom + 20);
	});

	// Draw y-axis labels
	ctx.fillStyle = '#888';
	ctx.font = '10px sans-serif';
	ctx.textAlign = 'right';
	for (let i = 0; i <= gridLines; i++) {
		const value = Math.round((i / gridLines) * maxValue);
		const y = height - paddingBottom - (i / gridLines) * chartHeight;
		ctx.fillText(value.toString(), paddingLeft - 10, y + 4);
	}
}

function loadStatistics() {
	fetch('/api/admin/statistics/user-activity', { credentials: 'include' })
		.then(r => {
			if (!r.ok) throw new Error('Failed to load statistics');
			return r.json();
		})
		.then(data => {
			// Students stats
			const studentDailyTotal = data.students.daily_breakdown_last_7_days.reduce((sum, d) => sum + d.active_users, 0);
			document.getElementById('stat-active-7d-students').textContent = studentDailyTotal;
			const studentMonthlyTotal = data.students.monthly_breakdown.reduce((sum, m) => sum + m.active_users, 0);
			document.getElementById('stat-avg-monthly-students').textContent = studentMonthlyTotal;
			document.getElementById('stat-registered-students').textContent = data.students.registered_total;

			// Teachers stats
			const teacherDailyTotal = data.teachers.daily_breakdown_last_7_days.reduce((sum, d) => sum + d.active_users, 0);
			document.getElementById('stat-active-7d-teachers').textContent = teacherDailyTotal;
			const teacherMonthlyTotal = data.teachers.monthly_breakdown.reduce((sum, m) => sum + m.active_users, 0);
			document.getElementById('stat-avg-monthly-teachers').textContent = teacherMonthlyTotal;
			document.getElementById('stat-registered-teachers').textContent = data.teachers.registered_total;

			// Create daily charts (reverse data so oldest is on the left)
			const studentDailyReversed = [...data.students.daily_breakdown_last_7_days].reverse();
			const teacherDailyReversed = [...data.teachers.daily_breakdown_last_7_days].reverse();
			createChart('student-activity-chart', studentDailyReversed, '#28a745');
			createChart('teacher-activity-chart', teacherDailyReversed, '#ffc107');

			// Create monthly charts if canvases exist
			const monthlyStudentChart = document.getElementById('student-monthly-chart');
			const monthlyTeacherChart = document.getElementById('teacher-monthly-chart');
			if (monthlyStudentChart) {
				createMonthlyChart('student-monthly-chart', data.students.monthly_breakdown, '#28a745');
			}
			if (monthlyTeacherChart) {
				createMonthlyChart('teacher-monthly-chart', data.teachers.monthly_breakdown, '#ffc107');
			}
		})
		.catch(err => {
			console.error('Error loading statistics:', err);
			document.querySelectorAll('[id^="stat-"]').forEach(el => {
				el.textContent = '—';
			});
		});

	// Total task sets
	fetch('/api/all-tasksets', { credentials: 'include' })
		.then(r => r.ok ? r.json() : Promise.reject())
		.then(data => {
			if (Array.isArray(data)) {
				document.getElementById('stat-total-lists').textContent = data.length;
			}
		})
		.catch(() => {
			document.getElementById('stat-total-lists').textContent = '—';
		});

	// Total Users
	fetch('/api/admin/users', { credentials: 'include' })
		.then(r => r.ok ? r.json() : Promise.reject())
		.then(data => {
			if (Array.isArray(data)) {
				document.getElementById('stat-total-users').textContent = data.length;
			}
		})
		.catch(() => {
			document.getElementById('stat-total-users').textContent = '—';
		});
}

// ==================== Task Tags ====================

let taskTagPreviousFocus = null;
const finnishTaskTagCollator = new Intl.Collator('fi-FI');
let taskTagDeactivationMode = false;
let taskTagDeactivationBusy = false;
const selectedTaskTagIds = new Set();

function setTaskTypeStatus(message, isError = false) {
	const status = document.getElementById('task-type-status');
	if (!status) return;
	status.textContent = message;
	status.className = `task-tags-feedback ${isError ? 'is-error' : 'is-success'}`;
}

function setTaskTagModalStatus(message, isError = false) {
	const status = document.getElementById('task-tag-modal-status');
	if (!status) return;
	status.textContent = message;
	status.className = `task-tags-feedback mb-3 ${isError ? 'is-error' : 'is-success'}`;
}

function setTaskTagsMessage(containerId, message, isError = false) {
 const container = document.getElementById(containerId);
 if (!container) return;
 container.innerHTML = '';
 const messageElement = document.createElement('p');
 messageElement.className = `task-tags-message${isError ? ' is-error' : ''}`;
 messageElement.textContent = message;
 container.appendChild(messageElement);
}

function updateTaskTagDeactivationControls() {
 const addButton = document.getElementById('add-task-type-btn');
 const deactivateButton = document.getElementById('deactivate-task-type-btn');
 const controls = document.getElementById('task-tag-deactivate-controls');
 const cancelButton = document.getElementById('cancel-task-tag-deactivation');
 const confirmButton = document.getElementById('confirm-task-tag-deactivation');
 if (!addButton || !deactivateButton || !controls || !cancelButton || !confirmButton) return;

 const selectedCount = selectedTaskTagIds.size;
 addButton.disabled = taskTagDeactivationMode || taskTagDeactivationBusy;
 deactivateButton.disabled = taskTagDeactivationBusy;
 deactivateButton.textContent = taskTagDeactivationMode ? 'Cancel deactivation' : 'Deactivate tag';
 deactivateButton.classList.toggle('btn-outline-danger', !taskTagDeactivationMode);
 deactivateButton.classList.toggle('btn-outline-secondary', taskTagDeactivationMode);
 controls.hidden = !taskTagDeactivationMode;
 cancelButton.disabled = taskTagDeactivationBusy;
 confirmButton.disabled = taskTagDeactivationBusy || selectedCount === 0;
 confirmButton.textContent = selectedCount
  ? `Deactivate selected tags (${selectedCount})`
  : 'Deactivate selected tags';
}

function updateTaskTagChipState(chip) {
 const taskTypeId = Number(chip.dataset.taskTypeId);
 const isSelectable = taskTagDeactivationMode && !chip.classList.contains('task-tag-chip--inactive');
 const isSelected = isSelectable && selectedTaskTagIds.has(taskTypeId);

 chip.classList.toggle('task-tag-chip--selectable', isSelectable);
 chip.classList.toggle('task-tag-chip--selected', isSelected);
 if (isSelectable) {
  chip.setAttribute('role', 'button');
  chip.tabIndex = 0;
  chip.setAttribute('aria-pressed', String(isSelected));
  chip.setAttribute('aria-label', `${isSelected ? 'Deselect' : 'Select'} tag ${chip.textContent}`);
 } else {
  chip.removeAttribute('role');
  chip.removeAttribute('tabindex');
  chip.removeAttribute('aria-pressed');
  chip.removeAttribute('aria-label');
 }
}

function updateTaskTagChips() {
 document.querySelectorAll('#task-types-list .task-tag-chip').forEach(updateTaskTagChipState);
}

function toggleTaskTagSelection(chip) {
 if (!taskTagDeactivationMode) return;

 const taskTypeId = Number(chip.dataset.taskTypeId);
 if (!Number.isInteger(taskTypeId)) return;

 if (selectedTaskTagIds.has(taskTypeId)) {
  selectedTaskTagIds.delete(taskTypeId);
 } else {
  selectedTaskTagIds.add(taskTypeId);
 }
 updateTaskTagChipState(chip);
 updateTaskTagDeactivationControls();
}

function startTaskTagDeactivationMode() {
 taskTagDeactivationMode = true;
 selectedTaskTagIds.clear();
 updateTaskTagChips();
 updateTaskTagDeactivationControls();
 setTaskTypeStatus('Select one or more tags to deactivate. Selected tags turn red.');
}

function cancelTaskTagDeactivationMode() {
 taskTagDeactivationMode = false;
 taskTagDeactivationBusy = false;
 selectedTaskTagIds.clear();
 updateTaskTagChips();
 updateTaskTagDeactivationControls();
 setTaskTypeStatus('');
}

async function deactivateSelectedTaskTags() {
 if (!taskTagDeactivationMode || selectedTaskTagIds.size === 0) return;

 const selectedChips = [...document.querySelectorAll('#task-types-list .task-tag-chip--selected')];
 const selectedTags = selectedChips.map(chip => ({
  id: Number(chip.dataset.taskTypeId),
  label: chip.textContent.trim(),
 }));
 if (!selectedTags.length) return;

 const tagNames = selectedTags.map(tag => `“${tag.label}”`).join(', ');
 const confirmed = window.confirm(`Are you sure you want to deactivate tags ${tagNames}? They will no longer be available for new tasks.`);
 if (!confirmed) return;

 taskTagDeactivationBusy = true;
 updateTaskTagDeactivationControls();
 try {
  await Promise.all(selectedTags.map(async (tag) => {
   const response = await fetch(`/api/admin/task-types/${encodeURIComponent(tag.id)}`, {
    method: 'DELETE',
    credentials: 'include',
   });
   if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Failed to deactivate tag “${tag.label}”`);
   }
  }));

  cancelTaskTagDeactivationMode();
  setTaskTypeStatus(`Deactivated tags ${tagNames}.`);
  await loadTaskTypes();
 } catch (error) {
  console.error('Error deactivating tags:', error);
  taskTagDeactivationBusy = false;
  updateTaskTagDeactivationControls();
  setTaskTypeStatus(error.message || 'Failed to deactivate selected tags.', true);
 }
}

async function reactivateTaskTag(taskType, button) {
 button.disabled = true;
 try {
  const response = await fetch(`/api/admin/task-types/${encodeURIComponent(taskType.id)}`, {
   method: 'PATCH',
   headers: { 'Content-Type': 'application/json' },
   credentials: 'include',
   body: JSON.stringify({ is_active: true }),
  });
  if (!response.ok) {
   const payload = await response.json().catch(() => ({}));
   throw new Error(payload.detail || `Failed to reactivate tag “${taskType.label}”`);
  }

  setTaskTypeStatus(`Reactivated “${taskType.label}”.`);
  await loadTaskTypes();
 } catch (error) {
  console.error('Error reactivating tag:', error);
  button.disabled = false;
  setTaskTypeStatus(error.message || 'Failed to reactivate tag.', true);
 }
}

async function loadTaskTypes() {
 if (!document.getElementById('task-types-list')) return;

 setTaskTagsMessage('task-types-list', 'Loading tags...');
 try {
  const response = await fetch('/api/admin/task-types', { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to load tags');
  renderTaskTypes(await response.json());
 } catch (error) {
  console.error('Error loading tags:', error);
  setTaskTagsMessage('task-types-list', 'Failed to load tags', true);
 }
}

function renderTaskTagChips(container, taskTypes, isInactive = false) {
 container.innerHTML = '';
 if (!taskTypes.length) {
  setTaskTagsMessage(container.id, isInactive ? 'No inactive tags.' : 'No tags configured.');
  return;
 }

 taskTypes.forEach((taskType) => {
  const chip = document.createElement('span');
  chip.className = `task-tag-chip${isInactive ? ' task-tag-chip--inactive' : ''}`;
  chip.dataset.taskTypeId = String(taskType.id);
  chip.textContent = taskType.label;
  if (!isInactive) {
   chip.addEventListener('click', () => toggleTaskTagSelection(chip));
   chip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
     event.preventDefault();
     toggleTaskTagSelection(chip);
    }
   });
  }
  updateTaskTagChipState(chip);
  if (isInactive) {
   const tagItem = document.createElement('div');
   tagItem.className = 'task-tag-inactive-item';
   tagItem.appendChild(chip);

   const reactivateButton = document.createElement('button');
   reactivateButton.type = 'button';
   reactivateButton.className = 'btn btn-sm btn-outline-success task-tag-reactivate-button';
   reactivateButton.textContent = 'Reactivate';
   reactivateButton.setAttribute('aria-label', `Reactivate ${taskType.label}`);
   reactivateButton.addEventListener('click', () => reactivateTaskTag(taskType, reactivateButton));
   tagItem.appendChild(reactivateButton);
   container.appendChild(tagItem);
  } else {
   container.appendChild(chip);
  }
 });
}

function renderTaskTypes(taskTypes) {
 const activeList = document.getElementById('task-types-list');
 const inactiveList = document.getElementById('inactive-task-types-list');
 const inactiveSection = document.getElementById('inactive-task-tags');
 const inactiveCount = document.getElementById('inactive-task-tags-count');
 if (!activeList || !inactiveList || !inactiveSection || !inactiveCount) return;

 const configuredTaskTypes = Array.isArray(taskTypes) ? taskTypes : [];
 const activeTaskTypes = configuredTaskTypes
  .filter(taskType => taskType.is_active)
  .sort((first, second) => finnishTaskTagCollator.compare(first.label, second.label));
 const inactiveTaskTypes = configuredTaskTypes
  .filter(taskType => !taskType.is_active)
  .sort((first, second) => finnishTaskTagCollator.compare(first.label, second.label));

 renderTaskTagChips(activeList, activeTaskTypes);
 renderTaskTagChips(inactiveList, inactiveTaskTypes, true);
 inactiveCount.textContent = String(inactiveTaskTypes.length);
 inactiveSection.hidden = inactiveTaskTypes.length === 0;
}

function openTaskTagModal() {
 const modal = document.getElementById('task-tag-modal');
 const title = document.getElementById('task-tag-modal-title');
 const description = document.getElementById('task-tag-modal-description');
 const input = document.getElementById('task-tag-name');
	const saveButton = document.getElementById('task-tag-save');
	if (!modal || !title || !description || !input || !saveButton) return;

 taskTagPreviousFocus = document.activeElement;
 title.textContent = 'Add tag';
 description.textContent = 'Add a tag teachers can assign to tasks.';
 saveButton.textContent = 'Add tag';
 input.value = '';
 setTaskTagModalStatus('');
 modal.hidden = false;
 input.focus();
}

function closeTaskTagModal() {
	const modal = document.getElementById('task-tag-modal');
	const input = document.getElementById('task-tag-name');
 if (!modal) return;

 modal.hidden = true;
 if (input) input.value = '';
	setTaskTagModalStatus('');
	if (taskTagPreviousFocus instanceof HTMLElement) taskTagPreviousFocus.focus();
	taskTagPreviousFocus = null;
}

async function saveTaskTag() {
	const input = document.getElementById('task-tag-name');
	const saveButton = document.getElementById('task-tag-save');
 const label = input?.value.trim() || '';
 if (!input || !saveButton) return;
	if (!label) {
		setTaskTagModalStatus('Enter a tag name.', true);
		input.focus();
		return;
	}

 saveButton.disabled = true;
 try {
  const response = await fetch('/api/admin/task-types', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   credentials: 'include',
   body: JSON.stringify({ label }),
  });
  if (!response.ok) {
   const payload = await response.json().catch(() => ({}));
   throw new Error(payload.detail || 'Failed to add tag');
  }

  closeTaskTagModal();
  setTaskTypeStatus(`Added “${label}”.`);
  await loadTaskTypes();
	} catch (error) {
		console.error('Error saving tag:', error);
		setTaskTagModalStatus(error.message, true);
	} finally {
		saveButton.disabled = false;
	}
}

function initTaskTypeManagement() {
	const addButton = document.getElementById('add-task-type-btn');
 const deactivateButton = document.getElementById('deactivate-task-type-btn');
	const modal = document.getElementById('task-tag-modal');
	const cancelButton = document.getElementById('task-tag-cancel');
 const closeButton = document.getElementById('task-tag-modal-close');
 const form = document.getElementById('task-tag-form');
 const saveButton = document.getElementById('task-tag-save');
 const input = document.getElementById('task-tag-name');
 if (!addButton || !deactivateButton || !modal || !cancelButton || !closeButton || !form || !saveButton || !input) return;

 addButton.addEventListener('click', openTaskTagModal);
 deactivateButton.addEventListener('click', () => {
  if (taskTagDeactivationMode) {
   cancelTaskTagDeactivationMode();
  } else {
   startTaskTagDeactivationMode();
  }
 });

 document.getElementById('cancel-task-tag-deactivation')?.addEventListener('click', cancelTaskTagDeactivationMode);
 document.getElementById('confirm-task-tag-deactivation')?.addEventListener('click', deactivateSelectedTaskTags);
 cancelButton.addEventListener('click', closeTaskTagModal);
 closeButton.addEventListener('click', closeTaskTagModal);
 form.addEventListener('submit', (event) => {
  event.preventDefault();
  saveTaskTag();
 });
 modal.addEventListener('click', (event) => {
  if (event.target === modal) closeTaskTagModal();
 });
 document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
   if (!modal.hidden) {
    closeTaskTagModal();
   } else if (taskTagDeactivationMode) {
    cancelTaskTagDeactivationMode();
   }
  }
 });

	updateTaskTagDeactivationControls();
	loadTaskTypes();
}

// ==================== Token Management ====================

function initTokenManagement() {
	const generateBtn = document.getElementById('generate-token-btn');
	const addTokenBtn = document.getElementById('add-token-btn');
	const copyBtn = document.getElementById('copy-token-btn');

	if (generateBtn) {
		generateBtn.addEventListener('click', generateToken);
	}
	if (addTokenBtn) {
		addTokenBtn.addEventListener('click', addToken);
	}
	if (copyBtn) {
		copyBtn.addEventListener('click', copyTokenToClipboard);
	}

	loadTokensList();
}

function generateToken() {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let token = '';
	for (let i = 0; i < 15; i++) {
		token += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	const tokenInput = document.getElementById('token-input');
	tokenInput.value = token;
	tokenInput.focus();
}

function addToken() {
	const tokenInput = document.getElementById('token-input');
	const token = tokenInput.value.trim();

	if (!token) {
		alert('Please enter or generate a token');
		return;
	}

	if (token.length < 10) {
		alert('Token must be at least 10 characters long');
		return;
	}

	const btn = document.getElementById('add-token-btn');
	const originalText = btn.innerHTML;
	btn.disabled = true;
	btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';

	fetch('/api/admin/registration-tokens', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ token })
	})
	.then(r => {
		if (!r.ok) {
			if (r.status === 400) {
				return r.json().then(data => { throw new Error(data.detail || 'Invalid token'); });
			}
			throw new Error('Failed to add token');
		}
		return r.json();
	})
	.then(data => {
		const tokenDisplay = document.getElementById('token-display');
		const tokenValue = document.getElementById('token-value');
		const tokenExpires = document.getElementById('token-expires');
		if (tokenDisplay && tokenValue) {
			tokenValue.textContent = data.token || token;
			if (tokenExpires) tokenExpires.textContent = data.expires_at ? formatDate(data.expires_at) : '';
			tokenDisplay.style.display = 'block';
		}
		tokenInput.value = '';
		loadTokensList();
		btn.disabled = false;
		btn.innerHTML = originalText;
	})
	.catch(err => {
		console.error('Error adding token:', err);
		alert('Failed to add token: ' + err.message);
		btn.disabled = false;
		btn.innerHTML = originalText;
	});
}

function loadTokensList() {
	const listContainer = document.getElementById('tokens-list');
	if (!listContainer) return;

	listContainer.innerHTML = '<div class="text-muted small"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

	fetch('/api/admin/registration-tokens', { credentials: 'include' })
	.then(r => {
		if (!r.ok) throw new Error('Failed to load tokens');
		return r.json();
	})
	.then(tokens => {
		if (!Array.isArray(tokens) || tokens.length === 0) {
			listContainer.innerHTML = '<p class="text-muted small mb-0">No tokens created yet</p>';
			return;
		}
		let html = '';
		tokens.forEach(token => {
			const createdDate = formatDate(token.created_at);
			const expiresDate = token.expires_at ? formatDate(token.expires_at) : 'N/A';
			html += `
				<div class="token-item p-2 border-bottom d-flex justify-content-between align-items-center">
					<div style="flex: 1; min-width: 0;">
						<small class="text-dark"><strong>ID: ${token.id}</strong></small><br>
						<small class="text-muted">Created: ${createdDate}</small><br>
						<small class="text-muted"><i class="fas fa-clock"></i> Expires: ${expiresDate}</small>
					</div>
					<button class="btn btn-sm btn-outline-danger ml-2" onclick="deleteToken(${token.id})" aria-label="Delete token ${token.id}">
						<i class="fas fa-trash" aria-hidden="true"></i>
					</button>
				</div>
			`;
		});
		listContainer.innerHTML = html;
	})
	.catch(err => {
		console.error('Error loading tokens:', err);
		listContainer.innerHTML = '<p class="text-danger small mb-0">Failed to load tokens</p>';
	});
}

window.deleteToken = function(tokenId) {
	if (!confirm('Are you sure you want to delete this token? Teachers won\'t be able to register with it anymore.')) {
		return;
	}
	fetch(`/api/admin/registration-tokens/${tokenId}`, {
		method: 'DELETE',
		credentials: 'include'
	})
	.then(r => {
		if (!r.ok) throw new Error('Failed to delete token');
		loadTokensList();
	})
	.catch(err => {
		console.error('Error deleting token:', err);
		alert('Failed to delete token: ' + err.message);
	});
};

function copyTokenToClipboard() {
	const tokenValue = document.getElementById('token-value');
	if (!tokenValue) return;
	navigator.clipboard.writeText(tokenValue.textContent).then(() => {
		const btn = document.getElementById('copy-token-btn');
		const originalText = btn.innerHTML;
		btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
		setTimeout(() => { btn.innerHTML = originalText; }, 2000);
	}).catch(err => {
		console.error('Failed to copy:', err);
		alert('Failed to copy token');
	});
}

// ==================== Access Check ====================

fetch('/api/admin/registration-tokens', { credentials: 'include' })
	.then(r => {
		if (r.status === 403 || r.status === 401) {
			window.location.href = '/';
			return;
		}
		if (r.ok) {
			initTokenManagement();
			initTaskTypeManagement();
			loadStatistics();
		}
	})
	.catch(() => {
		window.location.href = '/';
	});
