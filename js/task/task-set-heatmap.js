import { escapeHtml } from '../utils/ui-utils.js';
import { fetchJsonWithError } from '../utils/api-utils.js';

let heatmapSetId = null;

// ─── Heatmap helpers ───────────────────────────────────────────────────────
function daysAgo(isoString) {
	if (!isoString) return null;
	const diff = Date.now() - new Date(isoString).getTime();
	return Math.floor(diff / 86_400_000);
}

function progColor(ratio) {
	if (ratio >= 0.75) return 'var(--green)';
	if (ratio >= 0.40) return 'var(--amber)';
	return 'var(--red)';
}

const STATUS_LABELS = {
	completed:   { label: 'Completed',   color: 'var(--green)' },
	in_progress: { label: 'In Progress', color: 'var(--amber)' },
	struggling:  { label: 'Struggling',  color: 'var(--red)'   },
	not_started: { label: 'Not Started', color: 'var(--gray)'  },
};

let hmCurrentSort = 'name';

function hmSortStudents(students, mode) {
	const arr = [...students];
	const countStatus  = (s, st) => s.cells.filter(c => c.status === st).length;
	const uncompleted  = s => s.cells.filter(c => c.status !== 'completed').length;
	const attemptsOnUncompleted = s => s.cells.filter(c => c.status !== 'completed').reduce((sum, c) => sum + (c.attempts || 0), 0);

	if (mode === 'name') return arr.sort((a, b) => a.username.localeCompare(b.username));
	if (mode === 'most' || mode === 'least') {
		arr.sort((a, b) => {
			const cmp1 = countStatus(b, 'completed') - countStatus(a, 'completed');
			if (cmp1 !== 0) return cmp1;
			const cmp2 = uncompleted(a) - uncompleted(b);
			if (cmp2 !== 0) return cmp2;
			return attemptsOnUncompleted(b) - attemptsOnUncompleted(a);
		});
		return mode === 'least' ? arr.reverse() : arr;
	}
	return arr;
}

// ─── Heatmap: tooltip ──────────────────────────────────────────────────────
const hmTooltip = document.getElementById('hm-tooltip');
let hmTtVisible = false;

function hmShowTooltip(e, student, taskIdx, tasks) {
	const cell = student.cells[taskIdx];
	const task = tasks[taskIdx];
	const sm   = STATUS_LABELS[cell.status];
	const days = daysAgo(cell.last_active_at);
	const lastStr = days === null ? '—' : days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
	const attStr  = cell.attempts > 0 ? `${cell.attempts} attempt${cell.attempts !== 1 ? 's' : ''}` : 'No attempts yet';

	hmTooltip.innerHTML = `
		<div class="tt-header">${escapeHtml(student.username)}</div>
		<div class="tt-status-row">
			<span class="tt-dot" style="background:${sm.color}"></span>
			<span class="tt-status-label">${sm.label}</span>
		</div>
		<div class="tt-meta">${escapeHtml(task.title)}</div>
		<div class="tt-meta">${attStr}</div>
		<div class="tt-meta">Last active: ${lastStr}</div>
		<span class="tt-hint">Click to view details →</span>
	`;
	hmPositionTooltip(e);
	hmTooltip.classList.add('visible');
	hmTtVisible = true;
}

function hmHideTooltip()      { hmTooltip.classList.remove('visible'); hmTtVisible = false; }
function hmPositionTooltip(e) {
	const pad = 14, tw = hmTooltip.offsetWidth || 210, th = hmTooltip.offsetHeight || 140;
	let x = e.clientX + pad, y = e.clientY + pad;
	if (x + tw > window.innerWidth  - 8) x = e.clientX - tw - pad;
	if (y + th > window.innerHeight - 8) y = e.clientY - th - pad;
	hmTooltip.style.left = x + 'px';
	hmTooltip.style.top  = y + 'px';
}

// ─── Heatmap: modal ────────────────────────────────────────────────────────
const hmModal       = document.getElementById('hm-modal-overlay');
const hmModalTitle  = document.getElementById('hm-modal-title');
const hmModalBody   = document.getElementById('hm-modal-body');
const hmModalFooter = document.getElementById('hm-modal-footer');
const hmModalClose  = document.getElementById('hm-modal-close');

function hmOpenModal()  { hmModal.classList.add('open'); }
function hmCloseModal() { hmModal.classList.remove('open'); }

if (hmModalClose) hmModalClose.addEventListener('click', hmCloseModal);
if (hmModal) hmModal.addEventListener('click', e => { if (e.target === hmModal) hmCloseModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hmCloseModal(); });

async function hmOpenTaskPreview(task, taskSet) {
	hmModalTitle.textContent = task.title;
	hmModalBody.innerHTML = `<div class="hm-modal-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`;
	hmModalFooter.innerHTML = '';
	hmOpenModal();

	const statsUrl = `/task-statistics?id=${task.id}&task_set=${encodeURIComponent(taskSet.unique_link_code)}&set_id=${heatmapSetId}`;
	hmModalFooter.innerHTML = `
		<a href="${statsUrl}" class="hm-modal-btn-stats" target="_blank">
			<i class="fas fa-chart-bar"></i> View Task Statistics
		</a>
		<button class="hm-modal-btn-cancel" id="hm-modal-cancel">Close</button>
	`;
	document.getElementById('hm-modal-cancel').addEventListener('click', hmCloseModal);

	try {
		const [stats, taskData] = await Promise.all([
			fetchJsonWithError(
				`/api/tasks/${task.id}/statistics?task_set_code=${encodeURIComponent(taskSet.unique_link_code)}`,
				'Failed to load task statistics'
			),
			fetchJsonWithError(`/api/tasks/${task.id}`, 'Failed to load task'),
		]);
		const modelAnswer = stats.model_answer || '';
		let parsed = null;
		try { parsed = JSON.parse(taskData.task_instructions); } catch (_) { /* not JSON */ }
		const instrText  = parsed?.task_instructions || taskData.task_instructions || '';
		const examples   = parsed?.examples || '';

		let bodyHtml = '';
		if (instrText) {
			bodyHtml += `
				<div class="hm-modal-section-label">Task Instructions</div>
				<div class="hm-modal-description">${escapeHtml(instrText)}</div>
			`;
		}
		if (examples) {
			bodyHtml += `
				<div class="hm-modal-section-label" style="margin-top:.75rem">Examples</div>
				<pre class="hm-modal-code" style="max-height:140px">${escapeHtml(examples)}</pre>
			`;
		}
		bodyHtml += `
			<div class="hm-modal-section-label" style="margin-top:.75rem">Model Answer</div>
			<pre class="hm-modal-code">${escapeHtml(modelAnswer || '(no model answer available)')}</pre>
		`;
		hmModalBody.innerHTML = bodyHtml;
	} catch (err) {
		hmModalBody.innerHTML = `<div class="hm-modal-loading" style="color:var(--red)"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(err.message)}</div>`;
	}
}

// ─── Heatmap: render controls ──────────────────────────────────────────────
function hmRenderControls(tasks, students, onSort) {
	const container = document.getElementById('hm-controls');
	container.innerHTML = `
		<span class="hm-controls-label">Sort by</span>
		<div class="hm-sort-group" id="hm-sort-group">
			<button class="hm-sort-btn active" data-sort="name">Name A→Z</button>
			<button class="hm-sort-btn" data-sort="most">Most complete</button>
			<button class="hm-sort-btn" data-sort="least">Least complete</button>
		</div>
	`;
	container.querySelector('#hm-sort-group').addEventListener('click', e => {
		const btn = e.target.closest('.hm-sort-btn');
		if (!btn) return;
		container.querySelectorAll('.hm-sort-btn').forEach(b => b.classList.remove('active'));
		btn.classList.add('active');
		hmCurrentSort = btn.dataset.sort;
		onSort();
	});
}

// ─── Heatmap: render legend ────────────────────────────────────────────────
function hmRenderLegend() {
	document.getElementById('hm-legend').innerHTML = `
		<span class="hm-legend-title">Status</span>
		<span class="hm-legend-item"><span class="hm-swatch hm-s-completed"></span>Completed</span>
		<span class="hm-legend-item"><span class="hm-swatch hm-s-in_progress"></span>In progress <span style="font-size:.7rem;opacity:.6;margin-left:.2rem;">(# = attempts)</span></span>
		<span class="hm-legend-item"><span class="hm-swatch hm-s-struggling"></span>Struggling <span style="font-size:.7rem;opacity:.6;margin-left:.2rem;">(# = attempts)</span></span>
		<span class="hm-legend-item"><span class="hm-swatch hm-s-not_started"></span>Not started</span>
		<span class="hm-legend-note">Click any cell to view student × task detail</span>
	`;
}

// ─── Heatmap: render table ─────────────────────────────────────────────────
function hmRenderTable(tasks, students, taskSet) {
	const sorted = hmSortStudents(students, hmCurrentSort);
	const n      = sorted.length;

	const colRates = tasks.map((_, ti) => {
		const done = students.filter(s => s.cells[ti]?.status === 'completed').length;
		return n > 0 ? done / n : 0;
	});

	let thead = '<thead>';
	thead += '<tr>';
	thead += '<th class="hm-corner-th">Student</th>';
	tasks.forEach((task, ti) => {
		thead += `<th class="hm-task-th" data-task-idx="${ti}" title="Click to preview task: ${escapeHtml(task.title)}">
			<span class="hm-th-num">T${ti + 1}</span>
			<span class="hm-th-name">${escapeHtml(task.title)}</span>
			<span class="hm-th-peek"><i class="fas fa-eye"></i></span>
		</th>`;
	});
	thead += '<th class="hm-progress-th">Progress</th>';
	thead += '</tr>';

	thead += '<tr>';
	thead += '<th class="hm-corner-th hm-corner-rate">Completion rate</th>';
	tasks.forEach((_, ti) => {
		const pct   = Math.round(colRates[ti] * 100);
		const color = progColor(colRates[ti]);
		thead += `<th class="hm-rate-th">
			<span class="hm-rate-num" style="color:${color}">${pct}%</span>
			<div class="hm-rate-bar"><div style="width:${pct}%;background:${color};height:100%;border-radius:2px;"></div></div>
		</th>`;
	});
	thead += '<th class="hm-progress-th hm-progress-rate-th"></th>';
	thead += '</tr>';
	thead += '</thead>';

	let tbody = '<tbody>';
	sorted.forEach(student => {
		const doneCount = student.cells.filter(c => c.status === 'completed').length;
		const ratio     = tasks.length > 0 ? doneCount / tasks.length : 0;
		const pct       = Math.round(ratio * 100);
		const strCount  = student.cells.filter(c => c.status === 'struggling').length;
		let   badgeHTML = '';
		if (strCount >= 3) {
			badgeHTML = `<span class="hm-student-badge hm-badge-red">struggling</span>`;
		}

		tbody += `<tr class="hm-student-row">`;
		tbody += `<td class="hm-student-td">
			<a class="hm-student-link" href="/student-attempts?student_id=${encodeURIComponent(student.id)}&student=${encodeURIComponent(student.username)}&set_id=${heatmapSetId}">${escapeHtml(student.username)}</a>
			${badgeHTML}
		</td>`;

		student.cells.forEach((cell, ti) => {
			const stClass = `hm-st-${cell.status}`;
			let   inner   = '';
			if (cell.status === 'completed') inner = '<i class="fas fa-check" style="font-size:.62rem;"></i>';
			else if (cell.attempts > 0)      inner = String(cell.attempts);

			tbody += `<td class="hm-cell-td" data-student="${escapeHtml(student.username)}" data-task-idx="${ti}">
				<div class="hm-cell-inner ${stClass}">${inner}</div>
			</td>`;
		});

		tbody += `<td class="hm-prog-td">
			<div class="hm-prog-bar-wrap"><div class="hm-prog-bar-fill" style="width:${pct}%;background:${progColor(ratio)};"></div></div>
			<span class="hm-prog-count" style="color:${progColor(ratio)}">${doneCount}&thinsp;/&thinsp;${tasks.length}</span>
		</td>`;
		tbody += '</tr>';
	});
	tbody += '</tbody>';

	const table = document.getElementById('hm-table');
	table.innerHTML = thead + tbody;

	table.querySelectorAll('.hm-task-th[data-task-idx]').forEach(th => {
		th.addEventListener('click', () => {
			const ti = parseInt(th.dataset.taskIdx);
			hmOpenTaskPreview(tasks[ti], taskSet);
		});
	});

	table.querySelectorAll('.hm-cell-td').forEach(td => {
		td.addEventListener('mouseenter', e => {
			const s  = sorted.find(st => st.username === td.dataset.student);
			const ti = parseInt(td.dataset.taskIdx);
			if (s) hmShowTooltip(e, s, ti, tasks);
		});
		td.addEventListener('mousemove', e => { if (hmTtVisible) hmPositionTooltip(e); });
		td.addEventListener('mouseleave', hmHideTooltip);
		td.addEventListener('click', () => {
			const s  = sorted.find(st => st.username === td.dataset.student);
			const ti = parseInt(td.dataset.taskIdx);
			if (s) {
				window.location.href =
					`/student-task-statistics?student_id=${encodeURIComponent(s.id)}&student=${encodeURIComponent(s.username)}&task_id=${tasks[ti].id}&set_id=${heatmapSetId}`;
			}
		});
	});
}

// ─── Heatmap: load and render ──────────────────────────────────────────────
export async function loadHeatmap(taskSet, setId) {
	heatmapSetId = setId;
	try {
		const heatmap = await fetchJsonWithError(`/api/my_sets/${setId}/heatmap`, 'Failed to load heatmap data');
		const { tasks, students } = heatmap;

		hmRenderControls(tasks, students, () => hmRenderTable(tasks, students, taskSet));
		hmRenderLegend();
		hmRenderTable(tasks, students, taskSet);
	} catch (err) {
		console.error('Heatmap load error:', err);
		const container = document.getElementById('heatmap-container');
		container.innerHTML = `
			<div class="empty-state">
				<i class="fas fa-exclamation-triangle text-danger"></i>
				<h4>Error Loading Heatmap</h4>
				<p>${escapeHtml(err.message || 'An unexpected error occurred.')}</p>
			</div>
		`;
	}
}
