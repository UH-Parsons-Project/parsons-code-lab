import { TaskSearchFilter } from '../components/task-search-filter.js';
import {initNavbarExercisesButton, initSignedInAs, initProtectedPage, initBurgerMenu} from '../core/auth-ui.js';
import { isPrivateTask } from '../components/privacy-badge.js';
import { formatDate, escapeHtml } from '../utils/ui-utils.js';

initSignedInAs();

initNavbarExercisesButton();

initProtectedPage('/');

initBurgerMenu();

// Load exercise list
const container = document.getElementById('problems-list');
const taskCountBadge = document.getElementById('task-count-badge');


let allTasks = [];
let searchFilter = null;

function truncate(text, maxLength) {
	if (!text) return '';
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength) + '...';
}

const taskDetailCache = new Map();
let currentPreviewTaskId = null;

async function fetchTaskDetail(id) {
	if (!taskDetailCache.has(id)) {
		const promise = fetch('/api/tasks/' + encodeURIComponent(id), { credentials: 'include' })
			.then(r => r.ok ? r.json() : null)
			.catch(err => {
				console.error('Failed to fetch task details:', err);
				return null;
			});
		taskDetailCache.set(id, promise);
	}
	return taskDetailCache.get(id);
}

function renderPreviewSkeleton(item) {
	const panel = document.getElementById('task-preview-panel');
	if (!panel) return;

	currentPreviewTaskId = item.id;

	const isFav = item.is_favorite;
	const typeClass = item.task_type === 'Faded' ? 'type-faded' : 'type-normal';
	const typeText = item.task_type || 'normal';
	const visibilityBadge = isPrivateTask(item)
		? '<span class="preview-badge priv"><i class="fas fa-lock"></i> Private</span>'
		: '<span class="preview-badge pub"><i class="fas fa-globe"></i> Public</span>';

	panel.innerHTML = `
		<div class="task-preview-card">
			<div class="preview-section">
				<div class="preview-header-row">
					<div style="min-width:0; flex:1;">
						<div class="preview-title">
							${escapeHtml(item.title)}
							${item.created_at ? `<span class="task-card-date"><i class="far fa-calendar-alt"></i> ${formatDate(item.created_at)}</span>` : ''}
						</div>
						<div class="preview-badges">
							<span class="preview-badge ${typeClass}"><i class="fas fa-tag"></i> ${escapeHtml(typeText)}</span>
							${visibilityBadge}
							${item.faded ? '<span class="preview-badge type-faded"><i class="fas fa-keyboard"></i> Faded</span>' : ''}
						</div>
						<div class="preview-meta">
							${item.creator_username ? '<i class="fas fa-user"></i> Teacher ' + escapeHtml(item.creator_username) : ''}
						</div>
					</div>
					<button type="button" class="task-favorite-button ${isFav ? 'is-favorite' : ''}" id="preview-fav-btn" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
						${isFav ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>'}
					</button>
				</div>
			</div>

			<div class="preview-section">
				<div class="preview-section-label"><i class="fas fa-align-left"></i> Problem Statement</div>
				<div class="preview-skeleton-line full"></div>
				<div class="preview-skeleton-line medium"></div>
				<div class="preview-skeleton-line short"></div>
			</div>

			<div class="preview-section">
				<div class="preview-blocks-model-grid">
					<div>
						<div class="preview-section-label"><i class="fas fa-cubes"></i> Code Blocks</div>
						<div class="preview-skeleton-block"></div>
						<div class="preview-skeleton-block"></div>
						<div class="preview-skeleton-block"></div>
					</div>
					<div>
						<div class="preview-section-label"><i class="fas fa-check-circle"></i> Model Answer</div>
						<div class="preview-skeleton-block" style="height: 5.5rem;"></div>
					</div>
				</div>
			</div>

			<div class="preview-section">
				<div class="preview-actions">
					<a href="/task-details?id=${encodeURIComponent(item.id)}" class="btn btn-sm btn-outline-primary">
						<i class="fas fa-info-circle"></i> Full Details
					</a>
					<a href="/task?id=${encodeURIComponent(item.id)}" target="_blank" class="btn btn-sm btn-primary">
						<i class="fas fa-play"></i> Solve Task
					</a>
				</div>
			</div>
		</div>
	`;

	const favBtn = document.getElementById('preview-fav-btn');
	if (favBtn) {
		favBtn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			try {
				await toggleFavorite(item);
			} catch (err) {
				console.error('Failed to update favorite:', err);
			}
		});
	}
}

function renderPreviewFull(item, taskData) {
	if (currentPreviewTaskId !== item.id) return;
	const panel = document.getElementById('task-preview-panel');
	if (!panel) return;

	if (!taskData) {
		const problemSec = panel.querySelector('.preview-section:nth-child(2)');
		if (problemSec) {
			problemSec.innerHTML = `
				<div class="preview-section-label"><i class="fas fa-exclamation-triangle text-danger"></i> Task Content</div>
				<p class="preview-text text-muted">Unable to load task details.</p>
			`;
		}
		return;
	}

	// 1. Problem instructions / description
	let problemHtml = '';
	if (taskData.description) {
		problemHtml += `<div class="preview-text text-muted mb-2" style="font-size: 0.8rem; font-style: italic;">${escapeHtml(taskData.description)}</div>`;
	}

	let instructionsText = '';
	let examplesText = '';
	try {
		const parsedInst = typeof taskData.task_instructions === 'string'
			? JSON.parse(taskData.task_instructions)
			: taskData.task_instructions;
		if (parsedInst && typeof parsedInst === 'object') {
			if (parsedInst.function_name) {
				instructionsText += `<strong>${escapeHtml(parsedInst.function_name)}</strong><br>`;
			}
			instructionsText += escapeHtml(parsedInst.task_instructions || '');
			if (parsedInst.examples) {
				examplesText = escapeHtml(parsedInst.examples);
			}
		} else {
			instructionsText = escapeHtml(taskData.task_instructions || '');
		}
	} catch (e) {
		instructionsText = escapeHtml(taskData.task_instructions || '');
	}

	if (!instructionsText && !problemHtml) {
		instructionsText = 'No instructions provided.';
	}

	problemHtml += `<div class="preview-text">${instructionsText}</div>`;
	if (examplesText) {
		problemHtml += `
			<div class="mt-2" style="font-size: 0.78rem;">
				<strong>Examples:</strong>
				<pre style="background: #f1f5f9; padding: 0.4rem 0.6rem; border-radius: 4px; font-family: var(--gs-mono); margin-top: 0.2rem; margin-bottom: 0;"><code>${examplesText}</code></pre>
			</div>
		`;
	}

	// 2. Code blocks
	const blocks = taskData.code_blocks?.blocks || [];
	const correctOrder = new Set(taskData.correct_solution?.correct_order || []);
	let blocksHtml = '';

	if (blocks.length === 0) {
		blocksHtml = '<p class="preview-text text-muted" style="font-style: italic;">No code blocks configured.</p>';
	} else {
		const MAX_SHOW = 12;
		const displayBlocks = blocks.slice(0, MAX_SHOW);
		const overflowCount = blocks.length - MAX_SHOW;

		blocksHtml = '<div class="preview-blocks-list">';
		displayBlocks.forEach(b => {
			const isSolution = correctOrder.has(b.id);
			const isPinned = b.given === true;
			let blockClass = 'dist';
			let badgeText = 'Distractor';

			if (isPinned) {
				blockClass = 'pin';
				badgeText = '📌 Pinned';
			} else if (isSolution) {
				blockClass = 'sol';
				badgeText = '';
			}

			const formattedCode = escapeHtml(b.code || '')
				.replace(/(!BLANK|___)/g, '___');

			const indentLevel = b.indent || 0;
			const paddingLeft = Math.max(0.55, indentLevel * 1.2 + 0.55);
			const badgeHtml = badgeText ? `<span class="preview-block-badge">${badgeText}</span>` : '';

			blocksHtml += `
				<div class="preview-block ${blockClass}" style="padding-left: ${paddingLeft}rem;">
					<code>${formattedCode}</code>
					${badgeHtml}
				</div>
			`;
		});
		blocksHtml += '</div>';

		if (overflowCount > 0) {
			blocksHtml += `<div class="preview-more-blocks">+ ${overflowCount} more block${overflowCount > 1 ? 's' : ''}</div>`;
		}
	}

	// 3. Model answer — for public/student previews prefer the canonical
	// solution_code so blanks are preserved rather than showing teacher-filled
	// model answers.
	const rawModelCode = (taskData.correct_solution?.solution_code || '').trim();
	let modelHtml = '';
	if (rawModelCode) {
		modelHtml = `<pre class="preview-model-code">${escapeHtml(rawModelCode)}</pre>`;
	} else {
		modelHtml = '<p class="preview-text text-muted" style="font-style: italic;">No model answer configured.</p>';
	}

	// Update sections
	const sections = panel.querySelectorAll('.preview-section');
	if (sections[1]) {
		sections[1].innerHTML = `
			<div class="preview-section-label"><i class="fas fa-align-left"></i> Problem Statement</div>
			${problemHtml}
		`;
	}
	if (sections[2]) {
		sections[2].innerHTML = `
			<div class="preview-blocks-model-grid">
				<div>
					<div class="preview-section-label"><i class="fas fa-cubes"></i> Code Blocks (${blocks.length})</div>
					${blocksHtml}
				</div>
				<div>
					<div class="preview-section-label"><i class="fas fa-check-circle text-success"></i> Model Answer</div>
					${modelHtml}
				</div>
			</div>
		`;
	}
}

function createExerciseCard(item) {
	const card = document.createElement('div');
	card.className = 'task-set-item';
	card.style.cursor = 'pointer';
	const openDetails = () => {
		window.location.href = `/task-details?id=${encodeURIComponent(item.id)}`;
	};
	card.onclick = openDetails;

	let hoverTimer = null;
	card.addEventListener('mouseenter', () => {
		renderPreviewSkeleton(item);
		hoverTimer = setTimeout(() => {
			fetchTaskDetail(item.id).then(data => {
				renderPreviewFull(item, data);
			});
		}, 500);
	});
	card.addEventListener('mouseleave', () => {
		if (hoverTimer) clearTimeout(hoverTimer);
	});

	const header = document.createElement('div');
	header.className = 'task-set-item-top';

	const headerContent = document.createElement('div');
	headerContent.className = 'task-card-header-content';

	const titleWrap = document.createElement('div');
	titleWrap.className = 'task-card-title-row';

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = item.title;
	titleWrap.appendChild(title);

	if (item.created_at) {
		const dateSpan = document.createElement('span');
		dateSpan.className = 'task-card-date';
		dateSpan.innerHTML = `<i class="far fa-calendar-alt"></i> ${formatDate(item.created_at)}`;
		titleWrap.appendChild(dateSpan);
	}

	headerContent.appendChild(titleWrap);

	const badges = document.createElement('div');
	badges.className = 'preview-badges task-list-badges';

	const typeBadge = document.createElement('span');
	const typeClass = item.task_type === 'Faded' ? 'type-faded' : 'type-normal';
	typeBadge.className = `task-type-badge ${typeClass}`;
	typeBadge.innerHTML = `<i class="fas fa-tag"></i> ${escapeHtml(item.task_type || 'normal')}`;
	badges.appendChild(typeBadge);

	const visibilityBadge = document.createElement('span');
	const privateTask = isPrivateTask(item);
	visibilityBadge.className = `preview-badge ${privateTask ? 'priv' : 'pub'}`;
	visibilityBadge.innerHTML = privateTask
		? '<i class="fas fa-lock"></i> Private'
		: '<i class="fas fa-globe"></i> Public';
	badges.appendChild(visibilityBadge);

	if (item.faded) {
		const fadedBadge = document.createElement('span');
		fadedBadge.className = 'preview-badge type-faded';
		fadedBadge.innerHTML = '<i class="fas fa-keyboard"></i> Faded';
		badges.appendChild(fadedBadge);
	}

	headerContent.appendChild(badges);
	header.appendChild(headerContent);

	const favoriteBtn = document.createElement('button');
	favoriteBtn.type = 'button';
	favoriteBtn.className = 'task-favorite-button' + (item.is_favorite ? ' is-favorite' : '');
	favoriteBtn.innerHTML = item.is_favorite ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
	favoriteBtn.title = item.is_favorite ? 'Remove from favorites' : 'Add to favorites';
	favoriteBtn.setAttribute('aria-label', favoriteBtn.title);
	favoriteBtn.addEventListener('click', async (e) => {
		e.preventDefault();
		e.stopPropagation();
		try {
			await toggleFavorite(item);
		} catch (error) {
			console.error('Failed to update favorite:', error);
			alert('Could not update favorite right now.');
		}
	});
	header.appendChild(favoriteBtn);
	card.appendChild(header);

	const meta = document.createElement('div');
	meta.className = 'task-set-meta';
	if (item.creator_username) {
		meta.innerHTML = `<i class="fas fa-user"></i> Teacher ${escapeHtml(item.creator_username)}`;
	}
	card.appendChild(meta);

	const teaserText = item.task_instructions || item.description;
	if (teaserText) {
		const teaser = document.createElement('div');
		teaser.className = 'task-set-description';
		teaser.textContent = truncate(teaserText, 160);
		teaser.title = teaserText;
		card.appendChild(teaser);
	}

	const actions = document.createElement('div');
	actions.className = 'd-flex flex-wrap mt-2';
	actions.style.gap = '0.5rem';
	actions.addEventListener('click', (e) => e.stopPropagation());

	const statsBtn = document.createElement('a');
	statsBtn.href = `/task-statistics?id=${encodeURIComponent(item.id)}`;
	statsBtn.className = 'btn btn-sm btn-outline-primary';
	statsBtn.innerHTML = '<i class="fas fa-chart-line"></i> Global Statistics';

	const solveBtn = document.createElement('a');
	solveBtn.href = `/task?id=${encodeURIComponent(item.id)}`;
	solveBtn.target = '_blank';
	solveBtn.className = 'btn btn-sm btn-outline-secondary';
	solveBtn.innerHTML = '<i class="fas fa-play"></i> Solve Task';

	actions.appendChild(statsBtn);
	actions.appendChild(solveBtn);
	card.appendChild(actions);

	return card;
}

async function toggleFavorite(task) {
	const shouldFavorite = !task.is_favorite;
	const response = await fetch('/api/tasks/' + encodeURIComponent(task.id) + '/favorite', {
		method: shouldFavorite ? 'POST' : 'DELETE',
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error('Failed to update favorite');
	}

	const result = await response.json();
	task.is_favorite = Boolean(result.is_favorite);

	// Update preview panel if current item is open in preview
	if (currentPreviewTaskId === task.id) {
		const favBtn = document.getElementById('preview-fav-btn');
		if (favBtn) {
			favBtn.className = 'task-favorite-button' + (task.is_favorite ? ' is-favorite' : '');
			favBtn.innerHTML = task.is_favorite ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
			favBtn.title = task.is_favorite ? 'Remove from favorites' : 'Add to favorites';
		}
	}

	if (searchFilter) {
		searchFilter.applyFilters();
	}
}

function updateTaskCountBadge(count) {
	if (!taskCountBadge) return;
	taskCountBadge.textContent = count + (count === 1 ? ' task listed' : ' tasks listed');
	taskCountBadge.style.display = '';
}

function render(list) {
	container.className = '';
	container.innerHTML = '';
	updateTaskCountBadge(list.length);

	if (!list.length) {
		container.className = 'empty-state';
		container.innerHTML = `
			<i class="fas fa-folder-open"></i>
			<h4>No Exercises Found</h4>
			<p>There are no public exercises available right now.</p>
		`;
		return;
	}

	const cardsColumn = document.createElement('div');
	cardsColumn.className = 'task-sets-column';

	list.forEach(function (item) {
		cardsColumn.appendChild(createExerciseCard(item));
	});

	container.appendChild(cardsColumn);
}

// Filter UI logic moved to TaskSearchFilter component

function loadCurrentTeacher() {
	const storedUsername = localStorage.getItem('username');
	const storedUserId = localStorage.getItem('userId');

	let cachedId = null;
	if (storedUserId) {
		const parsedId = Number.parseInt(storedUserId, 10);
		if (!Number.isNaN(parsedId)) {
			cachedId = parsedId;
		}
	}

	if (searchFilter && (cachedId !== null || storedUsername)) {
		searchFilter.updateTeacher(cachedId, storedUsername || '');
	}

	fetch('/api/me', { credentials: 'include' })
		.then((r) => (r.ok ? r.json() : Promise.reject()))
		.then((data) => {
			if (data?.username) {
				localStorage.setItem('username', data.username);
			}
			if (typeof data?.id === 'number') {
				localStorage.setItem('userId', String(data.id));
			}
			if (searchFilter) {
				searchFilter.updateTeacher(data.id, data.username);
			}
		})
		.catch(() => {
			// Keep cached identity when /api/me is unavailable.
		});
}

searchFilter = new TaskSearchFilter('universal-task-search', {
	onFilter: render
});
loadCurrentTeacher();

// Fetch problems list
	fetch('/api/tasks', { credentials: 'include' })
	.then(function (resp) {
		if (!resp.ok) throw new Error('Network response not ok');
		return resp.json();
	})
	.then(function (json) {
		allTasks = json;
		searchFilter.setTasks(allTasks);
	})
	.catch(function () {
		container.className = 'empty-state';
		container.innerHTML = `
			<i class="fas fa-exclamation-triangle text-danger"></i>
			<h4>Error Loading Exercises</h4>
			<p>Unable to load exercise list.</p>
		`;
	});
