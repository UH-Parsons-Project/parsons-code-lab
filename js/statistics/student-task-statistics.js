import {initProtectedPage, initSignedInAs, initBurgerMenu} from '../core/auth-ui.js';
import { escapeHtml, formatDateTime, showError, formatTime } from '../utils/ui-utils.js';

initProtectedPage('/');
initSignedInAs();
initBurgerMenu();

const params = new URLSearchParams(window.location.search);
const studentUsername = params.get('student');
const studentId = params.get('student_id');
const taskId = params.get('task_id');
const setId = params.get('set_id');

if (!studentId || !taskId || !setId) {
	window.location.href = '/teacher-dashboard';
}
document.getElementById('student-name-badge').href = `/student-attempts?student_id=${encodeURIComponent(studentId)}&student=${encodeURIComponent(studentUsername || '')}&set_id=${encodeURIComponent(setId)}`;




function setupCollapsible(toggleId, bodyId, chevronId) {
	const toggle  = document.getElementById(toggleId);
	const body    = document.getElementById(bodyId);
	const chevron = document.getElementById(chevronId);
	if (!toggle || !body) return;

	toggle.setAttribute('tabindex', '0');
	toggle.setAttribute('role', 'button');

	const activate = () => {
		const open = !body.classList.contains('collapsed');
		body.classList.toggle('collapsed', open);
		toggle.setAttribute('aria-expanded', String(open));
		if (chevron) chevron.classList.toggle('open', !open);
	};

	toggle.addEventListener('click', activate);
	toggle.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			activate();
		}
	});
}

function renderHeader(data) {
	document.getElementById('page-header').style.display = 'none';
	document.getElementById('content-header').style.display = 'flex';
	document.getElementById('exercise-name').textContent = data.task_name || '—';
	document.getElementById('student-name-text').textContent = data.student_username || studentUsername;
	if (data.task_set_name) document.getElementById('taskset-name-label').textContent = data.task_set_name;

	const backBtn = document.getElementById('back-btn');
	if (backBtn) {
		backBtn.href = "#";
		backBtn.addEventListener('click', (e) => {
			e.preventDefault();
			history.back();
		});
	}
}

function renderTaskInstructions(taskInstructions) {
	const box = document.getElementById('task-instructions-box');
	const content = document.getElementById('task-instructions-content');

	if (!taskInstructions || !taskInstructions.trim()) {
		box.style.display = 'none';
		return;
	}

	let parsedInstructions = {};
	try {
		parsedInstructions = typeof taskInstructions === 'string'
			? JSON.parse(taskInstructions)
			: taskInstructions;
	} catch (e) {
		content.innerHTML = taskInstructions;
		box.style.display = 'block';
		return;
	}

	let html = '';
	if (parsedInstructions.function_name) html += `<strong>${escapeHtml(parsedInstructions.function_name)}</strong>`;
	if (parsedInstructions.task_instructions) html += ` ${escapeHtml(parsedInstructions.task_instructions)}`;
	if (parsedInstructions.examples) html += `<br><br><strong>Examples:</strong><pre style="margin-top: 0.5rem; background: #f1f5f9; padding: 0.75rem; border-radius: 6px;"><code>${escapeHtml(parsedInstructions.examples)}</code></pre>`;

	content.innerHTML = html;
	box.style.display = 'block';
}

function renderModelAnswer(modelAnswer) {
	const content = document.getElementById('model-answer-content');
	if (modelAnswer && modelAnswer.trim()) {
		content.innerHTML = '';
		const pre = document.createElement('pre');
		pre.className = 'model-code';
		pre.textContent = modelAnswer;
		content.appendChild(pre);
	}
}

function createAttemptItem(attempt) {
	const item = document.createElement('div');
	item.className = `attempt-item ${attempt.success ? 'success' : 'failure'}`;

	const timePart = attempt.time_taken !== null
		? ` &nbsp;·&nbsp; ${formatTime(attempt.time_taken)}`
		: '';

	item.innerHTML = `
		<div class="attempt-head">
			<span class="attempt-num">Attempt #${attempt.attempt_number}</span>
			<div class="attempt-meta-row">
				<span class="attempt-time"><i class="fas fa-clock mr-1"></i>${formatDateTime(attempt.completed_at)}${timePart}</span>
				<span class="attempt-badge ${attempt.success ? 'success' : 'failure'}">${attempt.success ? 'Success' : 'Failed'}</span>
			</div>
		</div>
	`;
	if (attempt.code) {
		const wrap = document.createElement('div');
		wrap.className = 'attempt-code-wrap';
		const pre = document.createElement('pre');
		pre.className = 'attempt-code';
		pre.textContent = attempt.code;
		wrap.appendChild(pre);
		item.appendChild(wrap);
	}

	return item;
}

function renderAttempts(attempts) {
	const list = document.getElementById('attempts-list');
	const count = document.getElementById('attempts-count');
	count.textContent = attempts.length;

	if (attempts.length === 0) {
		list.innerHTML = '<em class="text-muted" style="font-size:.85rem;">No attempts recorded yet.</em>';
		return;
	}

	list.innerHTML = '';
	attempts.forEach(attempt => list.appendChild(createAttemptItem(attempt)));
}

const EXIT_REASON_LABELS = {
	inactivity_timeout: 'Inactivity timeout',
	manual_navigation:  'Navigated away',
	page_close:         'Closed tab/window',
};

function renderSessions(sessions) {
	const list = document.getElementById('sessions-list');
	const count = document.getElementById('sessions-count');
	count.textContent = sessions.length;

	if (sessions.length === 0) {
		list.innerHTML = '<em class="text-muted" style="font-size:.85rem;">No sessions recorded.</em>';
		return;
	}

	list.innerHTML = '';
	sessions.forEach((s, i) => {
		const div = document.createElement('div');
		div.className = 'session-item';
		const duration = s.duration_seconds != null ? formatTime(s.duration_seconds) : '—';
		const exitLabel = EXIT_REASON_LABELS[s.exit_reason] ?? (s.exit_reason || 'No exit recorded');
		div.innerHTML = `
			<div class="session-info">
				<div class="session-num">Session #${i + 1}</div>
				<div class="session-detail">
					Entered: ${formatDateTime(s.entered_at)}<br>
					${s.exited_at ? `Exited: ${formatDateTime(s.exited_at)}<br>` : '<em>Still active</em><br>'}
					Duration: ${duration}
				</div>
			</div>
			<span class="session-exit">${escapeHtml(exitLabel)}</span>
		`;
		list.appendChild(div);
	});
}

function renderStatistics(data) {
	document.getElementById('stat-total').textContent   = data.total_attempts;
	document.getElementById('stat-success').textContent = data.successful_attempts;
	document.getElementById('stat-failed').textContent  = data.failed_attempts;

	if (data.empty_attempts && data.empty_attempts > 0) {
		document.getElementById('empty-attempts-item').style.display = 'block';
		document.getElementById('stat-empty').textContent = data.empty_attempts;
	}

	if (data.total_time_seconds) {
		document.getElementById('kpi-time-to-pass').textContent = formatTime(data.total_time_seconds);
	}

	const toggleTotal = document.getElementById('toggle-total');
	const toggleActive = document.getElementById('toggle-active');

	function renderTimeMetrics() {
		const activeOnly = toggleActive?.classList.contains('active') || false;

		const tfs = activeOnly ? data.time_to_first_success_on_page : data.time_to_first_success;
		const tff = activeOnly ? data.time_to_first_fail_on_page : data.time_to_first_fail;
		const think = activeOnly ? data.thinking_time_on_page : data.thinking_time;

		const successEl = document.getElementById('time-to-success');
		if (successEl) {
			successEl.textContent = tfs ? formatTime(tfs.seconds) : '—';
		}

		const failEl = document.getElementById('time-to-fail');
		if (failEl) {
			failEl.textContent = tff ? formatTime(tff.seconds) : '—';
		}

		const thinkEl = document.getElementById('thinking-time');
		const subEl = document.getElementById('thinking-time-sub');
		if (thinkEl) {
			if (think) {
				thinkEl.textContent = formatTime(think.seconds);
				thinkEl.style.fontSize = '';
				thinkEl.style.color = '';
				if (subEl) subEl.style.display = 'none';
			} else {
				thinkEl.textContent = '—';
				thinkEl.style.fontSize = '1rem';
				thinkEl.style.color = 'var(--gray)';
				if (subEl) subEl.style.display = '';
			}
		}
	}

	if (toggleTotal && toggleActive) {
		toggleTotal.onclick = () => {
			toggleTotal.classList.add('active');
			toggleActive.classList.remove('active');
			renderTimeMetrics();
		};
		toggleActive.onclick = () => {
			toggleActive.classList.add('active');
			toggleTotal.classList.remove('active');
			renderTimeMetrics();
		};
	}

	renderTimeMetrics();

	if (data.move_count !== null && data.move_count !== undefined) {
		document.getElementById('move-count').textContent = data.move_count;
	}

	const exitsEl = document.getElementById('page-exits');
	if (exitsEl) {
		exitsEl.textContent = data.median_page_exits != null ? String(data.median_page_exits) : '—';
	}
}



// ── Replay engine ──────────────────────────────────────────────────────────

function countBlanks(code) {
	return (code.match(/___/g) || []).length;
}

function renderBlockElement(code, blanks) {
	const frag = document.createDocumentFragment();
	let i = 0;
	// Split on tokens ___ or !BLANK and keep delimiters
	const parts = code.split(/(___|!BLANK)/g);
	for (const part of parts) {
		if (part === '___' || part === '!BLANK') {
			const span = document.createElement('span');
			span.className = 'replay-blank';
			const val = (blanks && blanks[i] !== undefined) ? String(blanks[i]) : '';
			if (val) {
				span.textContent = val;
			} else {
				span.innerHTML = '&nbsp;&nbsp;';
			}
			i++;
			frag.appendChild(span);
		} else {
			// plain text part
			frag.appendChild(document.createTextNode(part));
		}
	}
	return frag;
}

function buildInitialState(initialBlocks) {
	const starter = [];
	const solution = [];

	const nonGiven = initialBlocks.filter(b => !b.given);
	const given = initialBlocks.filter(b => b.given);

	function alphabetizeCompare(a, b) {
		const aCode = a.code;
		const bCode = b.code;
		if (aCode.startsWith('#') || aCode.startsWith('print(') || aCode.startsWith('p !BLANK')) return 1;
		if (bCode.startsWith('#') || bCode.startsWith('print(') || bCode.startsWith('p !BLANK')) return -1;
		if (aCode > bCode) return 1;
		if (aCode < bCode) return -1;
		return 0;
	}
	const sorted = [...nonGiven].sort(alphabetizeCompare);

	for (const b of sorted) {
		starter.push({
			block_id: b.block_id, code: b.code, given: false,
			debug: b.debug || false, indent: b.indent,
			blanks: Array(countBlanks(b.code)).fill(''),
		});
	}
	for (const b of given) {
		solution.push({
			block_id: b.block_id, code: b.code, given: true,
			indent: b.indent, blanks: Array(countBlanks(b.code)).fill(''),
		});
	}

	return { starter, solution };
}

function deepCopyState(state) {
	return {
		starter:  state.starter.map(b => ({ ...b, blanks: [...b.blanks], debug: b.debug || false })),
		solution: state.solution.map(b => ({ ...b, blanks: [...b.blanks], debug: b.debug || false })),
	};
}

function applyEvent(state, event) {
	const next = deepCopyState(state);

	if (event.type === 'move') {
		const src = next[event.from_container];
		const dst = next[event.to_container];
		if (!src || !dst) return next;
		const idx = src.findIndex(b => b.block_id === event.block_id);
		if (idx === -1) return next;
		const [block] = src.splice(idx, 1);
		block.indent = event.to_indent;
		dst.splice(Math.min(event.to_index, dst.length), 0, block);
	} else if (event.type === 'edit') {
		for (const container of [next.starter, next.solution]) {
			const block = container.find(b => b.block_id === event.block_id);
			if (block) {
				if (!block.blanks[event.blank_index] && block.blanks[event.blank_index] !== '') {
					block.blanks[event.blank_index] = '';
				}
				block.blanks[event.blank_index] = event.value;
				break;
			}
		}
	}

	return next;
}

function renderReplayBoard(state, highlightBlockId) {
	const renderColumn = (blocks, containerId, noIndent) => {
		const el = document.getElementById(containerId);
		el.innerHTML = '';
		if (blocks.length === 0) {
			const em = document.createElement('em');
			em.className = 'text-muted';
			em.style.fontSize = '0.8rem';
			em.textContent = 'empty';
			el.appendChild(em);
			return;
		}
		for (const block of blocks) {
			const div = document.createElement('div');
			div.className = 'replay-block'
				+ (block.block_id === highlightBlockId ? ' highlight' : '')
				+ (block.given ? ' given' : '')
				+ (block.debug ? ' debug' : '');
			div.style.marginLeft = noIndent ? '0' : (block.indent * 20) + 'px';
			const frag = renderBlockElement(block.code, block.blanks);
			div.appendChild(frag);
			el.appendChild(div);
		}
	};

	renderColumn(state.starter, 'replay-starter-blocks', true);
	renderColumn(state.solution, 'replay-solution-blocks', false);
}

function formatRelativeTime(event, startTime) {
	if (event && event.event_time && startTime) {
		const t0 = new Date(startTime).getTime();
		const t1 = new Date(event.event_time).getTime();
		if (!isNaN(t0) && !isNaN(t1)) {
			const diff = Math.max(0, (t1 - t0) / 1000);
			return `+${diff.toFixed(2).replace('.', ',')}s`;
		}
	}
	return 'Not Available';
}

function renderReplayStep(states, events, stepIndex, startTime) {
	const total = events.length;
	document.getElementById('replay-step-label').textContent = `Step ${stepIndex} / ${total}`;
	document.getElementById('replay-prev').disabled = stepIndex === 0;
	document.getElementById('replay-next').disabled = stepIndex === total;

	const labelEl = document.getElementById('replay-event-label');
	const board   = document.getElementById('replay-board');

	if (stepIndex === 0) {
		labelEl.innerHTML = 'Initial state <span class="replay-timestamp">+00,00s</span>';
		board.classList.remove('replay-run-success-board', 'replay-run-fail-board');
		renderReplayBoard(states[0], null);
		return;
	}

	const event = events[stepIndex - 1];
	const timeStr = formatRelativeTime(event, startTime);
	const timeSpan = `<span class="replay-timestamp">${escapeHtml(timeStr)}</span>`;

	if (event.type === 'run') {
		const success = event.success;
		const badge = success
			? '<span class="replay-run-badge replay-run-success"><i class="fas fa-check mr-1"></i>Ran code — Passed</span>'
			: '<span class="replay-run-badge replay-run-fail"><i class="fas fa-times mr-1"></i>Ran code — Failed</span>';
		labelEl.innerHTML = `${badge} ${timeSpan}`;
		board.classList.remove('replay-run-success-board', 'replay-run-fail-board');
		board.classList.add(success ? 'replay-run-success-board' : 'replay-run-fail-board');
		renderReplayBoard(states[stepIndex], null);
		return;
	}

	board.classList.remove('replay-run-success-board', 'replay-run-fail-board');

	const rawCode = (event.block_code || event.block_id).replace(/!BLANK/g, '___');
	const blockLabel = `<span class="replay-block replay-block-inline">${escapeHtml(rawCode)}</span>`;

	if (event.type === 'edit') {
		const blankNum = event.blank_index + 1;
		const val = escapeHtml(event.value);
		const actionText = val
			? `Typed <strong>"${val}"</strong> into blank ${blankNum} of ${blockLabel}`
			: `Cleared blank ${blankNum} of ${blockLabel}`;
		labelEl.innerHTML = `${actionText} ${timeSpan}`;
	} else {
		const sameContainer = event.from_container === event.to_container;
		const sameIndex = event.from_index === event.to_index;
		const indentLabel = event.to_indent > 0 ? `, indent ${event.to_indent}` : '';
		let msg;
		if (sameContainer && sameIndex) {
			msg = `Indented ${blockLabel} to level ${event.to_indent}`;
		} else if (event.from_container === 'starter') {
			msg = `Moved ${blockLabel} to solution${indentLabel}`;
		} else if (event.to_container === 'starter') {
			msg = `Returned ${blockLabel} to starter`;
		} else {
			msg = `Reordered ${blockLabel} in solution${indentLabel}`;
		}
		labelEl.innerHTML = `${msg} ${timeSpan}`;
	}

	renderReplayBoard(states[stepIndex], event.block_id);
}

async function initReplay(studentId, taskId, setId) {
	const loadingEl  = document.getElementById('replay-loading');
	const boardEl    = document.getElementById('replay-board');
	const controlsEl = document.getElementById('replay-controls');
	const labelEl    = document.getElementById('replay-event-label');

	try {
		const response = await fetch(
			`/api/students/${encodeURIComponent(studentId)}/tasks/${taskId}/moves?set_id=${setId}`,
			{ credentials: 'include' }
		);

		if (!response.ok) {
			loadingEl.innerHTML = '<em class="text-muted">No replay data available.</em>';
			return;
		}

		const data = await response.json();
		const events = data.events || [];
		const initialBlocks = data.initial_blocks || [];
		const startTime = data.start_time || (events.length > 0 ? events[0].event_time : null);

		loadingEl.style.display = 'none';

		if (events.length === 0 && initialBlocks.length === 0) {
			boardEl.style.display = 'none';
			controlsEl.style.display = 'none';
			labelEl.textContent = '';
			document.getElementById('replay-step-label').textContent = 'No events recorded.';
			return;
		}

		const initialState = buildInitialState(initialBlocks);
		const states = [initialState];
		for (const event of events) {
			states.push(applyEvent(states[states.length - 1], event));
		}

		const slider = document.getElementById('replay-slider');
		slider.max = events.length;
		slider.value = 0;
		slider.disabled = events.length === 0;

		let currentStep = 0;

		const goToStep = (step) => {
			currentStep = step;
			slider.value = step;
			renderReplayStep(states, events, step, startTime);
		};
		renderReplayStep(states, events, currentStep, startTime);

		document.getElementById('replay-prev').addEventListener('click', () => {
			if (currentStep > 0) goToStep(currentStep - 1);
		});
		document.getElementById('replay-next').addEventListener('click', () => {
			if (currentStep < events.length) goToStep(currentStep + 1);
		});
		slider.addEventListener('input', () => goToStep(parseInt(slider.value, 10)));

		document.getElementById('replay-prev').disabled = false;
		document.getElementById('replay-next').disabled = events.length === 0;

	} catch (err) {
		console.error('Error initialising replay:', err);
		loadingEl.innerHTML = '<em class="text-danger">Error loading replay.</em>';
	}
}

// ── Collapsibles ───────────────────────────────────────────────────────────

setupCollapsible('instructions-toggle', 'instructions-body', 'instructions-chevron');
setupCollapsible('attempts-toggle', 'attempts-body',  'attempts-chevron');
setupCollapsible('replay-toggle',   'replay-body',    'replay-chevron');
setupCollapsible('sessions-toggle', 'sessions-body',  'sessions-chevron');
setupCollapsible('model-toggle',    'model-body',     'model-chevron');

// ── Load data ──────────────────────────────────────────────────────────────

fetch(`/api/students/${encodeURIComponent(studentId)}/tasks/${taskId}/statistics?set_id=${setId}`, {
	credentials: 'include'
})
	.then(r => {
		if (!r.ok) {
			if (r.status === 401) { window.location.href = '/'; return; }
			throw new Error('Failed to load statistics');
		}
		return r.json();
	})
	.then(data => {
		renderHeader(data);
		renderTaskInstructions(data.task_instructions);
		renderModelAnswer(data.model_answer);
		renderAttempts(data.attempts_detail);
		renderSessions(data.sessions || []);
		renderStatistics(data);
		initReplay(studentId, taskId, setId);
		document.getElementById('content-container').style.display = 'block';
	})
	.catch(err => {
		console.error('Error loading statistics:', err);
		if (err.message && err.message.includes('401')) {
			window.location.href = '/';
		} else {
			showError(err.message);
		}
	});
