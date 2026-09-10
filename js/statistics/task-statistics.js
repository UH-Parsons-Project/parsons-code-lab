import { initSignedInAs, initProtectedPage, initBurgerMenu } from '../core/auth-ui.js';
import { createPrivateBadge, isPrivateTask } from '../components/privacy-badge.js';
import { escapeHtml, formatTime } from '../utils/ui-utils.js';
import { openTaskPreview, setupPreviewModalClose } from '../task/task-preview.js';
initSignedInAs();
initProtectedPage('/');
initBurgerMenu();
setupPreviewModalClose();

const previewTaskButton = document.getElementById('preview-task-statistics-btn');
if (previewTaskButton) {
	previewTaskButton.addEventListener('click', () => openTaskPreview({ id: taskId }));
}

const params = new URLSearchParams(window.location.search);
const taskId = params.get('id');
const task_setCode = params.get('task_set');
const setId = params.get('set_id');

const backBtn = document.getElementById('back-btn');
if (backBtn) {
	backBtn.href = "#";
	backBtn.addEventListener('click', (e) => {
		e.preventDefault();
		history.back();
	});
}

if (!task_setCode) {
	const sidebar = document.querySelector('.student-sidebar');
	if (sidebar) sidebar.style.display = 'none';
	const layout = document.querySelector('.page-layout');
	if (layout) layout.style.gridTemplateColumns = '1fr';
	const tasksetChip = document.getElementById('taskset-chip');
	if (tasksetChip) tasksetChip.style.display = 'none';
	const globalChip = document.getElementById('global-chip');
	if (globalChip) globalChip.style.display = '';
	const toggleBtn = document.getElementById('sidebar-toggle-btn');
	if (toggleBtn) toggleBtn.style.display = 'none';
	// Common mistakes show student-submitted code, which can contain
	// personal data, so they're only shown within a teacher's own task set.
	const mistakesBox = document.getElementById('mistakes-box');
	if (mistakesBox) mistakesBox.style.display = 'none';
	const bottomRow = document.querySelector('.bottom-row');
	if (bottomRow) bottomRow.classList.add('mistakes-hidden');
} else {
	const codeEl = document.getElementById('taskset-code-label');
	if (codeEl) codeEl.textContent = task_setCode;
}

const CIRC = 376.99; // circumference of r=60 circle

const privateBadgeSlot = document.getElementById('exercise-private-badge');


function formatCount(n) { return String(Math.round(n)); }

function fmtTick(v, fmtFn) {
	if (fmtFn !== formatTime) return fmtFn(v);
	if (v === 0) return '0';
	if (v < 60) return `${v}s`;
	const m = Math.floor(v / 60), s = Math.round(v % 60);
	return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function niceAxisTicks(maxVal) {
	if (maxVal <= 0) return [0];
	const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
	const step = STEPS.find(s => s >= maxVal / 8) || STEPS[STEPS.length - 1];
	const roundedMax = Math.ceil(maxVal / step) * step;
	const ticks = [];
	for (let v = 0; v <= roundedMax + 0.001; v += step) ticks.push(v);
	return ticks;
}

function renderBoxPlot(containerId, stats, desc) {
	const container = document.getElementById(containerId);
	if (!container) return;

	const fmt = desc.fmt || formatTime;

	if (!stats || !stats.count) {
		container.innerHTML = `<div class="bp-metric" style="opacity:.45">
			<div class="bp-header">
				<div class="bp-name"><span class="bp-dot" style="background:${desc.color}"></span>${desc.name}</div>
				<span style="font-size:.7rem;color:var(--text-muted);font-style:italic;">Not yet tracked</span>
			</div>
		</div>`;
		return;
	}

	if (stats.count < 5) {
		container.innerHTML = `<div class="bp-metric">
			<div class="bp-header">
				<div class="bp-name">
					<span class="bp-dot" style="background:${desc.color}"></span>
					${desc.name}
					<span style="font-size:.65rem;color:var(--text-muted);font-weight:400;margin-left:.4rem;">n = ${stats.count}</span>
				</div>
				<span style="font-size:.72rem;color:var(--text-muted);font-style:italic;">Not enough data for a box plot</span>
			</div>
			<div style="display:flex;gap:2rem;padding:.5rem 0;font-size:.8rem;color:var(--text-muted);">
				<span>min <b style="color:var(--text);font-weight:700;">${fmt(stats.min)}</b></span>
				<span>median <b style="color:${desc.color};font-weight:700;">${fmt(stats.median)}</b></span>
				<span>avg <b style="color:var(--text);font-weight:700;">${fmt(stats.avg)}</b></span>
				<span>max <b style="color:var(--text);font-weight:700;">${fmt(stats.max)}</b></span>
			</div>
		</div>`;
		return;
	}

	const W = 1000;
	const outliers = stats.outliers || [];
	const whiskerLow = stats.whisker_low;
	const whiskerHigh = stats.whisker_high;
	const maxOutlier = outliers.length > 0 ? Math.max(...outliers) : 0;
	const dataMax = Math.max(whiskerHigh, maxOutlier, stats.max);

	// Break the axis when outliers are far from the fence (> 2× whiskerHigh)
	const W_MAIN = 780, W_BREAK = 44, W_OUT = W - 780 - 44; // 176
	const useAxisBreak = outliers.length > 0 && whiskerHigh > 0 && maxOutlier > 2 * whiskerHigh;
	let xp, ticks, breakX1 = -1, breakX2 = -1, cutoff = 0;

	if (useAxisBreak) {
		const mainTicks = niceAxisTicks(whiskerHigh);
		cutoff = mainTicks[mainTicks.length - 1];
		const outTotal = (maxOutlier - cutoff) * 1.1; // 10 % right padding
		xp = v => v <= cutoff
			? (v / cutoff) * W_MAIN
			: W_MAIN + W_BREAK + Math.min(((v - cutoff) / outTotal) * W_OUT, W_OUT);
		ticks = mainTicks;
		breakX1 = W_MAIN;
		breakX2 = W_MAIN + W_BREAK;
	} else {
		ticks = niceAxisTicks(dataMax);
		const scaleMax = ticks[ticks.length - 1] * 1.001 || 1;
		xp = v => (v / scaleMax) * W;
	}

	// Y layout: top labels → box plot → axis → tick labels
	const Y_VAL  = 14;            // bold value text
	const Y_NAME = 26;            // smaller label name
	const CY     = 53;            // box centre
	const BH     = 20;
	const BT     = CY - BH / 2;  // 43
	const BB     = CY + BH / 2;  // 63
	const AY     = 80;            // axis line
	const Y_TICK = 100;           // tick number labels

	const xWL = xp(whiskerLow), xWH = xp(whiskerHigh);
	const xQ1 = xp(stats.q1), xQ3 = xp(stats.q3);
	const xMed = xp(stats.median), xAvg = xp(stats.avg);
	const iqrWidth = Math.max(xQ3 - xQ1, 2);

	// ── top labels (value + name), priority-deduped ──────────────
	const hasLowOutliers  = outliers.some(v => v < whiskerLow);
	const hasHighOutliers = outliers.some(v => v > whiskerHigh);
	const rawLabels = [
		{ x: xMed,             val: fmt(stats.median), name: 'Median',  pri: 6, sz: 14, imp: true  },
		{ x: xQ3,              val: fmt(stats.q3),     name: 'Q3',      pri: 5, sz: 11, imp: false },
		{ x: xQ1,              val: fmt(stats.q1),     name: 'Q1',      pri: 5, sz: 11, imp: false },
		{ x: xWH,              val: fmt(whiskerHigh),  name: hasHighOutliers ? 'Fence' : 'Maximum', pri: 4, sz: hasHighOutliers ? 11 : 14, imp: !hasHighOutliers },
		{ x: xWL,              val: fmt(whiskerLow),   name: hasLowOutliers  ? 'Fence' : 'Minimum', pri: 3, sz: hasLowOutliers  ? 11 : 14, imp: !hasLowOutliers  },
		...(hasHighOutliers ? [{ x: xp(stats.max), val: fmt(stats.max), name: 'Maximum', pri: 2, sz: 14, imp: true }] : []),
		...(hasLowOutliers  ? [{ x: xp(stats.min), val: fmt(stats.min), name: 'Minimum', pri: 1, sz: 14, imp: true }] : []),
	];
	const MIN_LABEL_GAP = 80;
	const shownLabels = [];
	for (const lp of rawLabels) {
		if (!shownLabels.some(sl => Math.abs(sl.x - lp.x) < MIN_LABEL_GAP)) shownLabels.push(lp);
	}

	const p = [];

	for (const lp of shownLabels) {
		const a = lp.x < 30 ? 'start' : lp.x > W - 30 ? 'end' : 'middle';
		const valFill   = lp.imp ? desc.colorDark : '#78909c';
		const valWeight = lp.imp ? '800' : '600';
		const nameFill  = lp.imp ? '#64748b' : '#94a3b8';
		p.push(`<text x="${lp.x.toFixed(1)}" y="${Y_VAL}" text-anchor="${a}" font-family="DM Sans,sans-serif" font-size="${lp.sz}" font-weight="${valWeight}" fill="${valFill}">${lp.val}</text>`);
		p.push(`<text x="${lp.x.toFixed(1)}" y="${Y_NAME}" text-anchor="${a}" font-family="DM Sans,sans-serif" font-size="9.5" fill="${nameFill}">${lp.name}</text>`);
	}

	// ── box plot ─────────────────────────────────────────────────
	// whisker spine
	p.push(`<line x1="${xWL}" y1="${CY}" x2="${xWH}" y2="${CY}" stroke="${desc.color}" stroke-width="1.5"/>`);
	// whisker caps
	p.push(`<line x1="${xWL}" y1="${BT + 2}" x2="${xWL}" y2="${BB - 2}" stroke="${desc.color}" stroke-width="1.5"/>`);
	p.push(`<line x1="${xWH}" y1="${BT + 2}" x2="${xWH}" y2="${BB - 2}" stroke="${desc.color}" stroke-width="1.5"/>`);
	// IQR box
	p.push(`<rect x="${xQ1}" y="${BT}" width="${iqrWidth}" height="${BH}" fill="${desc.colorLight}" stroke="${desc.color}" stroke-width="1.5" rx="2"/>`);
	// median line
	p.push(`<line x1="${xMed}" y1="${BT}" x2="${xMed}" y2="${BB}" stroke="${desc.colorDark}" stroke-width="2.5"/>`);
	// mean diamond with hover tooltip
	p.push(
		`<g class="bp-avg-g">` +
			`<circle cx="${xAvg}" cy="${CY}" r="8" fill="transparent"/>` +
			`<path d="M ${xAvg} ${BT + 3} L ${xAvg + 5} ${CY} L ${xAvg} ${BB - 3} L ${xAvg - 5} ${CY} Z" fill="${desc.color}" stroke="white" stroke-width="1"/>` +
			`<rect class="bp-tip-bg" x="${xAvg - 30}" y="${BT - 34}" width="60" height="26" rx="3" fill="${desc.colorDark}"/>` +
			`<text class="bp-tip-text" x="${xAvg}" y="${BT - 22}" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="8" font-weight="700" fill="rgba(255,255,255,0.65)" letter-spacing="1">MEAN</text>` +
			`<text class="bp-tip-text" x="${xAvg}" y="${BT - 10}" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="10" font-weight="600" fill="white">${fmt(stats.avg)}</text>` +
		`</g>`
	);
	// outlier dots with hover tooltip
	for (const v of outliers) {
		const cx = +xp(v).toFixed(1);
		const label = fmt(v);
		p.push(
			`<g class="bp-outlier-g">` +
				`<circle cx="${cx}" cy="${CY}" r="7" fill="transparent"/>` +
				`<circle cx="${cx}" cy="${CY}" r="3.5" fill="${desc.color}" stroke="white" stroke-width="1.5"/>` +
				`<rect class="bp-tip-bg" x="${cx - 30}" y="${BT - 24}" width="60" height="16" rx="3" fill="#1e293b"/>` +
				`<text class="bp-tip-text" x="${cx}" y="${BT - 11}" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="10" font-weight="600" fill="white">${label}</text>` +
			`</g>`
		);
	}

	// ── axis + ticks ─────────────────────────────────────────────
	if (useAxisBreak) {
		p.push(`<line x1="0" y1="${AY}" x2="${breakX1}" y2="${AY}" stroke="#cbd5e1" stroke-width="1.5"/>`);
		p.push(`<line x1="${breakX2}" y1="${AY}" x2="${W}" y2="${AY}" stroke="#cbd5e1" stroke-width="1.5"/>`);
		// Break indicator: two diagonal slashes
		const bxMid = (breakX1 + breakX2) / 2;
		const SO = 8;
		p.push(`<line x1="${bxMid - SO - 4}" y1="${AY - 6}" x2="${bxMid - SO + 4}" y2="${AY + 6}" stroke="#94a3b8" stroke-width="1.5"/>`);
		p.push(`<line x1="${bxMid + SO - 4}" y1="${AY - 6}" x2="${bxMid + SO + 4}" y2="${AY + 6}" stroke="#94a3b8" stroke-width="1.5"/>`);
		p.push(`<text x="${bxMid}" y="${Y_TICK}" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="10" fill="#94a3b8">…</text>`);
	} else {
		p.push(`<line x1="0" y1="${AY}" x2="${W}" y2="${AY}" stroke="#cbd5e1" stroke-width="1.5"/>`);
	}
	for (const tv of ticks) {
		const tx = xp(tv);
		if (tx < 0 || tx > W + 1) continue;
		const a = tx < 15 ? 'start' : tx > W - 15 ? 'end' : 'middle';
		p.push(`<line x1="${tx.toFixed(1)}" y1="${AY}" x2="${tx.toFixed(1)}" y2="${AY + 7}" stroke="#cbd5e1" stroke-width="1"/>`);
		p.push(`<text x="${tx.toFixed(1)}" y="${Y_TICK}" text-anchor="${a}" font-family="DM Sans,sans-serif" font-size="10" fill="#94a3b8">${fmtTick(tv, fmt)}</text>`);
	}
	if (useAxisBreak) {
		const MIN_TICK_GAP = 45;
		const placedTx = ticks.map(tv => xp(tv));
		for (const v of [...new Set(outliers)].sort((a, b) => a - b)) {
			const tx = xp(v);
			if (placedTx.some(px => Math.abs(px - tx) < MIN_TICK_GAP)) continue;
			placedTx.push(tx);
			const a = tx > W - 15 ? 'end' : 'middle';
			p.push(`<line x1="${tx.toFixed(1)}" y1="${AY}" x2="${tx.toFixed(1)}" y2="${AY + 7}" stroke="#cbd5e1" stroke-width="1"/>`);
			p.push(`<text x="${tx.toFixed(1)}" y="${Y_TICK}" text-anchor="${a}" font-family="DM Sans,sans-serif" font-size="10" fill="#94a3b8">${fmtTick(v, fmt)}</text>`);
		}
	}

	container.innerHTML = `
		<div class="bp-metric">
			<div class="bp-header">
				<div class="bp-name">
					<span class="bp-dot" style="background:${desc.color}"></span>
					${desc.name}
					<span style="font-size:.65rem;color:var(--text-muted);font-weight:400;margin-left:.4rem;">n = ${stats.count}</span>
				</div>
				<div class="bp-summary">
					<span><span class="bp-summary-label">median</span> <b style="color:${desc.colorDark}">${fmt(stats.median)}</b></span>
					<span><span class="bp-summary-label">mean</span> <b>${fmt(stats.avg)}</b></span>
				</div>
			</div>
			<div class="bp-svg-wrap">
				<svg viewBox="0 0 ${W} 108" style="width:100%;height:auto;display:block;overflow:visible;">
					${p.join('')}
				</svg>
			</div>
		</div>`;
}



function showLoadError(message) {
	document.getElementById('exercise-name').textContent = message || 'Error loading data';
	const logsDiv = document.getElementById('input-logs');
	if (logsDiv) logsDiv.innerHTML = `<em>${escapeHtml(message || 'Could not load data.')}</em>`;
}


function updateDonut(completed, attempted, notStarted) {
	const notYetCompleted = attempted - completed;
	const total = attempted + notStarted;
	const hasNotYetCompleted = notYetCompleted > 0;
	const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
	const completedLen = total > 0 ? (completed / total) * CIRC : 0;
	const notYetCompletedLen = total > 0 ? (notYetCompleted / total) * CIRC : 0;
	const completedDeg = total > 0 ? (completed / total) * 360 - 90 : -90;

	const arcCompleted = document.getElementById('donut-arc-completed');
	const arcNotYetCompleted = document.getElementById('donut-arc-struggling');
	if (arcCompleted) {
		arcCompleted.setAttribute('stroke', '#16a34a');
		arcCompleted.setAttribute('stroke-dasharray', `${completedLen.toFixed(1)} ${(CIRC - completedLen).toFixed(1)}`);
	}
	if (arcNotYetCompleted) {
		arcNotYetCompleted.setAttribute('stroke', hasNotYetCompleted ? '#dc2626' : 'transparent');
		arcNotYetCompleted.setAttribute('stroke-dasharray', `${notYetCompletedLen.toFixed(1)} ${(CIRC - notYetCompletedLen).toFixed(1)}`);
		arcNotYetCompleted.setAttribute('transform', `rotate(${completedDeg} 80 80)`);
	}

	const pctText = document.getElementById('donut-percent-text');
	if (pctText) pctText.textContent = attempted > 0 ? `${pct}%` : '—';

	const elCompleted = document.getElementById('legend-completed');
	const elNotYetCompleted = document.getElementById('legend-struggling');
	const elNotStarted = document.getElementById('legend-not-started');
	const dotCompleted = document.getElementById('legend-dot-completed');
	const dotNotYetCompleted = document.getElementById('legend-dot-struggling');
	if (dotCompleted) dotCompleted.style.background = '#16a34a';
	if (dotNotYetCompleted) dotNotYetCompleted.style.background = hasNotYetCompleted ? '#dc2626' : '#cbd5e1';
	if (elCompleted) elCompleted.textContent = completed;
	if (elCompleted) elCompleted.style.color = 'var(--green)';
	if (elNotYetCompleted) {
		elNotYetCompleted.textContent = notYetCompleted;
		elNotYetCompleted.style.color = hasNotYetCompleted ? 'var(--red)' : 'var(--text-muted)';
	}
	if (elNotStarted) elNotStarted.textContent = notStarted > 0 ? notStarted : '—';
}

function renderSidebarSection(listEl, names, urlFn) {
	if (!names.length) {
		listEl.innerHTML = '';
		return;
	}
	listEl.innerHTML = names.map(n => {
		const url = urlFn ? urlFn(n) : null;
		const tag = url ? 'a' : 'div';
		const href = url ? ` href="${url}"` : '';
		return `
		<${tag} class="sidebar-row"${href}>
			<span class="sidebar-row-name">${escapeHtml(n.name)}</span>
			<span class="sidebar-row-meta">${escapeHtml(n.meta)}</span>
		</${tag}>`;
	}).join('');
}

function updateSidebar(completed, notYetCompleted, notStarted, total, students) {
	document.getElementById('sidebar-enrolled-count').textContent = total > 0 ? total : '—';

	const completedNames       = students?.completed        ?? [];
	const notYetCompletedNames = students?.not_yet_completed ?? [];
	const notStartedNames      = students?.not_started      ?? [];

	document.getElementById('sidebar-completed-count').textContent   = completed;
	document.getElementById('sidebar-struggling-count').textContent  = notYetCompleted;
	document.getElementById('sidebar-not-started-count').textContent = notStarted;

	const taskStatsUrl = (taskId && setId)
		? n => `/student-task-statistics?student_id=${encodeURIComponent(n.id)}&student=${encodeURIComponent(n.name)}&task_id=${encodeURIComponent(taskId)}&set_id=${encodeURIComponent(setId)}`
		: null;
	const attemptsUrl = setId
		? n => `/student-attempts?student_id=${encodeURIComponent(n.id)}&student=${encodeURIComponent(n.name)}&set_id=${encodeURIComponent(setId)}`
		: null;

	renderSidebarSection(
		document.getElementById('sidebar-completed-list'),
		completedNames,
		taskStatsUrl
	);
	renderSidebarSection(
		document.getElementById('sidebar-struggling-list'),
		notYetCompletedNames,
		taskStatsUrl
	);

	const notStartedList = document.getElementById('sidebar-not-started-list');
	if (notStarted === 0) {
		notStartedList.innerHTML = '<div class="sidebar-empty">All students have attempted this exercise.</div>';
	} else {
		renderSidebarSection(notStartedList, notStartedNames, attemptsUrl);
	}
}

async function loadStatistics() {
	if (!taskId) {
		document.getElementById('exercise-name').textContent = 'No task ID provided';
		return;
	}

	let apiUrl = `/api/tasks/${taskId}/statistics`;
	if (task_setCode) apiUrl += `?task_set_code=${encodeURIComponent(task_setCode)}`;

	let response;
	try {
		response = await fetch(apiUrl, { credentials: 'include' });
	} catch (error) {
		console.error('Error loading statistics:', error);
		showLoadError('Could not reach the statistics endpoint.');
		return;
	}

	if (!response.ok) {
		if (response.status === 401) {
			window.location.href = '/';
			return;
		}

		let errorMessage = 'Could not load statistics.';
		try {
			const errorBody = await response.json();
			if (errorBody?.detail) errorMessage = errorBody.detail;
		} catch (e) { /* ignore */ }

		console.error('Error loading statistics:', response.status, errorMessage);
		showLoadError(errorMessage);
		return;
	}

	let data;
	try {
		data = await response.json();
	} catch (error) {
		console.error('Error parsing statistics response:', error);
		showLoadError('Statistics response was invalid.');
		return;
	}

	// Header
	const taskName = data.task_name || '—';
	document.getElementById('exercise-name').textContent = taskName;
	if (privateBadgeSlot) {
		privateBadgeSlot.innerHTML = '';
		if (isPrivateTask(data)) {
			privateBadgeSlot.appendChild(createPrivateBadge());
		}
	}


	// KPI strip
	const totalAttempts = data.total_completions ?? 0;
	const studentsCompleted = data.students_completed ?? 0;
	const studentsAttempted = data.students_attempted ?? 0;
	const studentsNotStarted = data.students_not_started ?? 0;
	const studentsNotYetCompleted = studentsAttempted - studentsCompleted;
	const totalInSet = studentsAttempted + studentsNotStarted;
	const completionRate = studentsAttempted > 0
		? ((studentsCompleted / studentsAttempted) * 100).toFixed(1)
		: '0';

	document.getElementById('total-completions').textContent = totalAttempts;
	document.getElementById('students-completed-num').textContent = studentsCompleted;
	document.getElementById('students-attempted-denom').textContent = ` / ${studentsAttempted}`;
	document.getElementById('completion-rate-sub').textContent = `${completionRate}% completion rate`;
	document.getElementById('students-struggling').textContent = studentsNotYetCompleted;
	document.getElementById('kpi-not-started-num').textContent = studentsNotStarted;
	if (totalInSet > 0) {
		document.getElementById('kpi-not-started-denom').textContent = ` / ${totalInSet}`;
	}
	const medianExitsEl = document.getElementById('median-page-exits');
	if (medianExitsEl) {
		medianExitsEl.textContent = data.median_page_exits != null ? data.median_page_exits : '—';
	}

	// Sidebar
	updateSidebar(studentsCompleted, studentsNotYetCompleted, studentsNotStarted, totalInSet, data.students);

	// Donut
	updateDonut(studentsCompleted, studentsAttempted, studentsNotStarted);
	const avgTriesDonut = document.getElementById('avg-tries-donut');
	if (avgTriesDonut) avgTriesDonut.textContent = data.avg_tries != null ? `${data.avg_tries}×` : '—';
	const minTries = data.min_tries ?? null;
	const maxTries = data.max_tries ?? null;
	const minTriesEl = document.getElementById('avg-tries-min');
	const maxTriesEl = document.getElementById('avg-tries-max');
	if (minTriesEl) minTriesEl.textContent = minTries != null ? `${minTries}×` : '—';
	if (maxTriesEl) maxTriesEl.textContent = maxTries != null ? `${maxTries}×` : '—';
	if (minTries != null && maxTries != null && maxTries > minTries) {
		const barWrap = document.getElementById('avg-tries-bar-wrap');
		const fill = document.getElementById('avg-tries-bar-fill');
		const marker = document.getElementById('avg-tries-bar-marker');
		if (barWrap && fill && marker) {
			barWrap.style.display = '';
			const range = maxTries - minTries;
			const avgPct = ((data.avg_tries - minTries) / range) * 100;
			fill.style.width = `${avgPct}%`;
			marker.style.left = `${avgPct}%`;
		}
	}

	// Page exits min/avg/max rendering
	const avgExitsEl = document.getElementById('page-exits-avg');
	if (avgExitsEl) avgExitsEl.textContent = data.avg_page_exits != null ? data.avg_page_exits : '—';
	const minExits = data.min_page_exits ?? null;
	const maxExits = data.max_page_exits ?? null;
	const minExitsEl = document.getElementById('page-exits-min');
	const maxExitsEl = document.getElementById('page-exits-max');
	if (minExitsEl) minExitsEl.textContent = minExits != null ? minExits : '—';
	if (maxExitsEl) maxExitsEl.textContent = maxExits != null ? maxExits : '—';
	if (minExits != null && maxExits != null && maxExits > minExits) {
		const barWrap = document.getElementById('page-exits-bar-wrap');
		const fill = document.getElementById('page-exits-bar-fill');
		const marker = document.getElementById('page-exits-bar-marker');
		if (barWrap && fill && marker) {
			barWrap.style.display = '';
			const range = maxExits - minExits;
			const avgPct = ((data.avg_page_exits - minExits) / range) * 100;
			fill.style.width = `${avgPct}%`;
			marker.style.left = `${avgPct}%`;
		}
	}

	// Model answer
	if (data.model_answer) {
		document.getElementById('model-answer-content').innerHTML =
			`<pre class="model-code">${escapeHtml(data.model_answer)}</pre>`;
	}

	// Custom error messages
	const customErrorsBox = document.getElementById('custom-errors-box');
	if (data.custom_error_messages?.length > 0 && customErrorsBox) {
		const rules = data.custom_error_messages;
		const countEl = document.getElementById('custom-errors-count');
		if (countEl) countEl.textContent = rules.length + (rules.length === 1 ? ' rule' : ' rules');

		const html = rules.map(rule => {
			const pattern = escapeHtml(rule.pattern || '');
			const message = escapeHtml(rule.message || '');
			return `<div class="ce-rule">
				<div class="ce-rule-pattern">
					<span class="ce-rule-label">If code contains</span>
					<code>${pattern}</code>
				</div>
				<div class="ce-rule-msg">
					<span class="ce-rule-label ce-rule-label--arrow">&#8594; Student sees</span>
					<p>${message}</p>
				</div>
			</div>`;
		}).join('');

		document.getElementById('custom-errors-content').innerHTML =
			`<div class="ce-grid">${html}</div>`;
		customErrorsBox.style.display = '';
	}

	// Collapsible headers
	document.querySelectorAll('.collapsible-header').forEach(btn => {
		btn.addEventListener('click', () => {
			const targetId = btn.getAttribute('aria-controls');
			const body = document.getElementById(targetId);
			const chevron = btn.querySelector('.collapse-chevron');
			const expanded = btn.getAttribute('aria-expanded') === 'true';
			body.style.display = expanded ? 'none' : '';
			btn.setAttribute('aria-expanded', String(!expanded));
			chevron?.classList.toggle('collapsed', expanded);
		});
	});

	// Time metrics
	function renderTimeCharts() {
		const activeOnly = document.getElementById('toggle-active')?.classList.contains('active') || false;

		const tff = activeOnly ? data.time_to_first_fail_on_page : data.time_to_first_fail;
		const tfs = activeOnly ? data.time_to_first_success_on_page : data.time_to_first_success;
		const think = activeOnly ? data.thinking_time_on_page : data.thinking_time;

		if (tff) {
			document.getElementById('tff-metric').style.opacity = '';
			renderBoxPlot('bp-tff', tff, { name: 'Time to First Fail', color: '#dc2626', colorLight: '#fee2e2', colorDark: '#7f1d1d', fmt: formatTime });
		} else {
			renderBoxPlot('bp-tff', null, { name: 'Time to First Fail', color: '#dc2626' });
		}
		if (tfs) {
			document.getElementById('tfs-metric').style.opacity = '';
			renderBoxPlot('bp-tfs', tfs, { name: 'Time to First Success', color: '#16a34a', colorLight: '#dcfce7', colorDark: '#14532d', fmt: formatTime });
		} else {
			renderBoxPlot('bp-tfs', null, { name: 'Time to First Success', color: '#16a34a' });
		}
		if (think) {
			document.getElementById('thinking-time-metric').style.opacity = '';
			renderBoxPlot('bp-think', think, { name: 'Thinking Time', color: '#7b8df0', colorLight: '#e0e7ff', colorDark: '#3730a3', fmt: formatTime });
		} else {
			renderBoxPlot('bp-think', null, { name: 'Thinking Time', color: '#7b8df0' });
		}
	}

	renderTimeCharts();

	const toggleTotal = document.getElementById('toggle-total');
	const toggleActive = document.getElementById('toggle-active');
	if (toggleTotal && toggleActive) {
		toggleTotal.onclick = () => {
			toggleTotal.classList.add('active');
			toggleActive.classList.remove('active');
			renderTimeCharts();
		};
		toggleActive.onclick = () => {
			toggleActive.classList.add('active');
			toggleTotal.classList.remove('active');
			renderTimeCharts();
		};
	}

	if (data.number_of_moves) {
		document.getElementById('moves-metric').style.opacity = '';
		renderBoxPlot('bp-moves', data.number_of_moves, { name: 'Number of Moves', color: '#94a3b8', colorLight: '#e2e8f0', colorDark: '#334155', fmt: formatCount });
	}

	// Common mistakes (student-submitted code) are only shown within a
	// teacher's own task set, never on the anonymous global statistics view.
	const logsDiv = document.getElementById('input-logs');
	if (task_setCode && logsDiv) {
		if (data.common_mistakes?.length > 0) {
			const total = data.common_mistakes.reduce((sum, m) => sum + m.count, 0);
			const totalChip = document.getElementById('mistakes-total-chip');
			if (totalChip) totalChip.textContent = `${total} failed submission${total !== 1 ? 's' : ''} total`;

			const maxCount = data.common_mistakes[0].count;
			let html = '';
			data.common_mistakes.forEach((m, i) => {
				const pct = Math.round((m.count / maxCount) * 100);
				const rankLabel = i === 0 ? 'Most frequent' : '';
				html += `
				<div class="mistake-item">
					<div class="mistake-rank-row">
						<span class="mistake-rank"><span class="rank-num">${i + 1}</span>${rankLabel}</span>
						<span class="mistake-count-chip">${m.count} time${m.count !== 1 ? 's' : ''}</span>
					</div>
					<div class="mistake-freq-bar"><div class="mistake-freq-fill" style="width:${pct}%"></div></div>
					<pre class="mistake-code">${escapeHtml(m.code)}</pre>
				</div>`;
			});
			logsDiv.innerHTML = html;
		} else {
			logsDiv.innerHTML = '<em style="font-size:.85rem;">No failed attempts recorded yet.</em>';
		}
	}
}

loadStatistics();

// ── Mobile sidebar toggle ────────────────────────────────
const _toggleBtn = document.getElementById('sidebar-toggle-btn');
const _backdrop  = document.getElementById('sidebar-backdrop');
const _sidebar   = document.querySelector('.student-sidebar');

if (_toggleBtn && _backdrop && _sidebar) {
	const _openSidebar = () => {
		_sidebar.classList.add('sidebar-open');
		_backdrop.classList.add('show');
		document.body.style.overflow = 'hidden';
	};
	const _closeSidebar = () => {
		_sidebar.classList.remove('sidebar-open');
		_backdrop.classList.remove('show');
		document.body.style.overflow = '';
	};
	_toggleBtn.addEventListener('click', () => {
		_sidebar.classList.contains('sidebar-open') ? _closeSidebar() : _openSidebar();
	});
	_backdrop.addEventListener('click', _closeSidebar);
	window.addEventListener('resize', () => {
		if (window.innerWidth > 768) _closeSidebar();
	});
}
