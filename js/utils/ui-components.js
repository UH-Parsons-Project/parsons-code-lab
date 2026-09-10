import { makeKeyActivatable, formatDate, formatDateTimeWithoutSeconds, escapeHtml } from './ui-utils.js';
import { createPrivateBadge, isPrivateTask } from '../components/privacy-badge.js';

export function createTaskSetItem(taskSet, currentUsername = null) {
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

	const isExpired = Boolean(taskSet.expires_at && new Date(taskSet.expires_at) < new Date());

	const title = document.createElement('div');
	title.className = 'task-set-title';
	title.textContent = taskSet.title;
	titleWrap.appendChild(title);

	if (isPrivateTask(taskSet)) {
		titleWrap.appendChild(createPrivateBadge());
	}

	topRow.appendChild(titleWrap);

	if (taskSet.unique_link_code) {
		const chip = document.createElement('div');
		chip.className = 'task-set-code-chip';
		chip.title = 'Click to copy link';
		chip.innerHTML = `<i class="far fa-copy"></i>${taskSet.unique_link_code}`;
		const copyLink = (e) => {
			e.stopPropagation();
			const ownerParam = taskSet.owner_username ? encodeURIComponent(taskSet.owner_username) : '';
			const url = `${window.location.protocol}//${window.location.host}/${ownerParam}/set/${encodeURIComponent(taskSet.unique_link_code)}`;
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
	const isOpened = Boolean(taskSet.opens_at && new Date(taskSet.opens_at) <= new Date());
	const expiresSoon = Boolean(
		taskSet.expires_at &&
		!isExpired &&
		new Date(taskSet.expires_at) - new Date() < 86400000
	);
	const openingPart = taskSet.opens_at
		? ` &nbsp;·&nbsp; <span${isOpened ? ' class="task-set-opening-active"' : ''}><i class="far fa-calendar-alt"></i> ${isOpened ? 'Opened' : 'Opens'} ${formatDateTimeWithoutSeconds(taskSet.opens_at)}</span>`
		: '';
	let expiryPart = '';
	if (taskSet.expires_at) {
		expiryPart = isExpired
			? ` &nbsp;·&nbsp; <span class="text-danger font-weight-bold"><i class="fas fa-exclamation-circle"></i> Expired ${formatDateTimeWithoutSeconds(taskSet.expires_at)}</span>`
			: expiresSoon
				? ` &nbsp;·&nbsp; <span class="task-set-expiring-soon"><i class="far fa-clock"></i> Expires ${formatDateTimeWithoutSeconds(taskSet.expires_at)}</span>`
				: ` &nbsp;·&nbsp; <i class="far fa-clock"></i> Expires ${formatDateTimeWithoutSeconds(taskSet.expires_at)}`;
	}
	const sharedPart = (currentUsername && taskSet.owner_username && taskSet.owner_username !== currentUsername)
		? ` &nbsp;·&nbsp; <i class="fas fa-share-alt"></i> Shared by ${escapeHtml(taskSet.owner_username)}`
		: '';
	
	let countsPart = '';
	if (taskSet.task_count !== undefined && taskSet.student_count !== undefined) {
		countsPart = `<br><i class="fas fa-tasks"></i> ${taskSet.task_count} task${taskSet.task_count !== 1 ? 's' : ''} &nbsp;·&nbsp; ` +
			`<i class="fas fa-user-graduate"></i> ${taskSet.student_count} student${taskSet.student_count !== 1 ? 's' : ''} joined`;
	}

	meta.innerHTML = `<i class="far fa-calendar"></i> Created ${formatDate(taskSet.created_at)}${openingPart}${expiryPart}${sharedPart}${countsPart}`;
	item.appendChild(meta);

	if (taskSet.teacher_description) {
		const description = document.createElement('div');
		description.className = 'task-set-description';
		let displayText = taskSet.teacher_description;
		if (displayText.length > 228) {
			displayText = displayText.substring(0, 228) + '…';
		}
		description.textContent = displayText;
		description.title = taskSet.teacher_description;
		item.appendChild(description);
	}

	return item;
}
