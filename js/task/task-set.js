import { initStudentLogout, initSignedInAs, initNavbarExercisesButton , initBurgerMenu } from '/js/core/auth-ui.js';
import { makeKeyActivatable } from '/js/utils/ui-utils.js';
initBurgerMenu();

initSignedInAs({ preferNickname: true });

initStudentLogout();

initNavbarExercisesButton();

// Load problem list for this task_set
const container = document.getElementById('problems-list');
const pathParts = window.location.pathname.split('/');
const username = pathParts[1]; // /{username}/set/{unique_link_code}/tasks
const uniqueLinkCode = pathParts[3];

let tasksList = [];



async function loadProblemsetInfo() {
	try {
		const response = await fetch(`/api/my_sets/${uniqueLinkCode}/info`);
		if (!response.ok) {
			return;
		}
		const info = await response.json();

		// Update title
		const titleElement = document.querySelector('h2.mb-3');
		if (titleElement) {
			titleElement.textContent = info.title;
		}

		// Update description in info section
		const infoSection = document.getElementById('info-section');
		if (infoSection && info.student_description) {
			infoSection.innerHTML = '';

			const heading = document.createElement('h6');
			heading.className = 'info-heading';
			heading.textContent = 'About These Tasks';
			infoSection.appendChild(heading);

			const description = document.createElement('p');
			description.className = 'info-description';
			description.textContent = info.student_description;
			infoSection.appendChild(description);
		}
	} catch (error) {
		console.error('Failed to load task_set info:', error);
	}
}

function loadCompletionStatus(bulkStatus, statusElement, itemIndex, numberElement) {
	try {
		if (!bulkStatus) return;

		const hasStarted = Boolean(bulkStatus.has_started);
		const studentCompleted = Number(bulkStatus.student_completed || 0);

		if (studentCompleted > 0) {
			statusElement.className = 'task-set-meta task-completed';
			statusElement.innerHTML = '<i class="fas fa-check-circle"></i>Completed';
			if (numberElement) numberElement.classList.add('completed');
			tasksList[itemIndex].isCompleted = true;
		} else if (hasStarted) {
			statusElement.className = 'task-set-meta task-in-progress';
			statusElement.innerHTML = '<i class="fas fa-clock"></i>In Progress';
			tasksList[itemIndex].isCompleted = false;
		} else {
			tasksList[itemIndex].isCompleted = false;
		}

		updateProgressBar(tasksList);
	} catch (error) {
		console.error('Failed to load completion status:', error);
		tasksList[itemIndex].isCompleted = false;
		updateProgressBar(tasksList);
	}
}

function createTaskCard(item, index) {
	const card = document.createElement('div');
	card.className = 'task-set-item';
	const taskId = item.id;
	const navigate = () => { window.location.href = `/${username}/set/${uniqueLinkCode}/tasks/${taskId}/start`; };
	card.onclick = navigate;
	makeKeyActivatable(card, navigate);

	const number = document.createElement('div');
	number.className = 'task-set-item-number';
	number.textContent = index + 1;
	card.appendChild(number);

	const body = document.createElement('div');
	body.className = 'task-set-item-body';

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = item.title;
	body.appendChild(title);

	const status = document.createElement('div');
	status.className = 'task-set-meta';
	status.style.minHeight = '1.5rem';
	body.appendChild(status);

	card.appendChild(body);

	const chevron = document.createElement('i');
	chevron.className = 'fas fa-chevron-right task-set-item-chevron';
	card.appendChild(chevron);

	loadCompletionStatus(item._bulkStatus, status, index, number);

	return card;
}

function updateProgressBar(list) {
	const totalCount = list.length;
	const completedCount = list.filter(item => item.isCompleted).length;
	const percentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

	document.getElementById('total-count').textContent = totalCount;
	document.getElementById('completed-count').textContent = completedCount;
	document.getElementById('progress-bar').style.width = percentage + '%';
	document.getElementById('progress-bar').setAttribute('aria-valuenow', percentage);
	document.getElementById('progress-bar').textContent = percentage > 10 ? Math.round(percentage) + '%' : '';
}

function createDemoSection() {
	const section = document.createElement('div');
	section.style.cssText = 'margin-bottom: 2rem;';

	const heading = document.createElement('p');
	heading.style.cssText = 'font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #6c757d; margin-bottom: 0.5rem;';
	heading.textContent = 'Warm-up (optional)';
	section.appendChild(heading);

	const warmups = [
		{
			title: 'Arrange two print lines',
			description: 'Practice arranging code blocks to produce the right output',
			url: `/${username}/set/${uniqueLinkCode}/tasks/demo`,
		},
		{
			title: 'Indent one line',
			description: 'Arrange an if statement and indent its print line',
			url: `/${username}/set/${uniqueLinkCode}/tasks/demo?step=indent`,
		},
	];

	warmups.forEach(({ title: cardTitle, description, url }) => {
		const card = document.createElement('div');
		card.className = 'task-set-item';
		card.style.cssText = 'border-color: #ced4da; background: #f8f9fa;';
		const navigate = () => { window.location.href = url; };
		card.onclick = navigate;
		makeKeyActivatable(card, navigate);

		const badge = document.createElement('div');
		badge.className = 'task-set-item-number';
		badge.style.background = '#adb5bd';
		badge.textContent = '★';
		card.appendChild(badge);

		const body = document.createElement('div');
		body.className = 'task-set-item-body';

		const title = document.createElement('div');
		title.className = 'task-set-title';
		title.textContent = cardTitle;
		body.appendChild(title);

		const meta = document.createElement('div');
		meta.className = 'task-set-meta';
		meta.style.minHeight = '1.5rem';
		meta.textContent = description;
		body.appendChild(meta);

		card.appendChild(body);

		const chevron = document.createElement('i');
		chevron.className = 'fas fa-chevron-right task-set-item-chevron';
		card.appendChild(chevron);
		section.appendChild(card);
	});

	const divider = document.createElement('div');
	divider.style.cssText = 'margin-top: 2rem; margin-bottom: 0.5rem; border-top: 1px solid #dee2e6;';
	section.appendChild(divider);

	const tasksHeading = document.createElement('p');
	tasksHeading.style.cssText = 'font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #6c757d; margin-top: 0.75rem; margin-bottom: 0.5rem;';
	tasksHeading.textContent = 'Exercises';
	section.appendChild(tasksHeading);

	return section;
}

function render(list) {
	container.className = '';
	container.innerHTML = '';

	tasksList = list.map(item => ({ ...item, isCompleted: false }));

	if (!list.length) {
		container.className = 'empty-state';
		container.innerHTML = `
			<i class="fas fa-tasks"></i>
			<h4>No Tasks Found</h4>
			<p>There are no tasks in this set right now.</p>
		`;
		updateProgressBar(list);
		return;
	}

	const cardsColumn = document.createElement('div');
	cardsColumn.className = 'task-sets-column';

	cardsColumn.appendChild(createDemoSection());

	list.forEach(function (item, index) {
		cardsColumn.appendChild(createTaskCard(item, index));
	});

	container.appendChild(cardsColumn);
	updateProgressBar(tasksList);
}

if (uniqueLinkCode) {
	fetch(`/api/sets/${uniqueLinkCode}/is-enrolled`, { credentials: 'include' })
		.then(r => r.ok ? r.json() : { enrolled: false })
		.then(data => {
			if (!data.enrolled) {
				window.location.href = `/${username}/set/${uniqueLinkCode}`;
				return;
			}

			// Load task_set info (title and description)
			loadProblemsetInfo();

			// Fetch problems for this task_set
			Promise.all([
				fetch(`/api/my_sets/${uniqueLinkCode}/tasks`).then(r => { if (!r.ok) throw new Error('Network response not ok'); return r.json(); }),
				fetch(`/api/sets/${uniqueLinkCode}/tasks-status`, { credentials: 'include' }).then(r => r.ok ? r.json() : [])
			])
			.then(function ([json, statusesJson]) {
				const visibleTasks = json.filter(t => !t.is_hidden);
				visibleTasks.forEach((task, idx) => {
					task._bulkStatus = statusesJson[idx] || null;
				});
				render(visibleTasks);
			})
			.catch(function (error) {
				container.className = 'empty-state';
				container.innerHTML = `
					<i class="fas fa-exclamation-triangle text-danger"></i>
					<h4>Error Loading Tasks</h4>
					<p>Unable to load task set.</p>
				`;
				console.error(error);
			});
		})
		.catch(function (error) {
			console.error('Enrollment check failed:', error);
			window.location.href = `/${username}/set/${uniqueLinkCode}`;
		});
} else {
	container.className = 'empty-state';
	container.innerHTML = `
		<i class="fas fa-exclamation-circle text-warning"></i>
		<h4>Task Set Not Found</h4>
		<p>The task set you are looking for does not exist.</p>
	`;
}
