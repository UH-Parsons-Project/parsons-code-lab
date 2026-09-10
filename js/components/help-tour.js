/**
 * Dynamic CDN loader for Driver.js
 */
async function loadDriverJSAndCSS() {
	return new Promise((resolve, reject) => {
		// Check and load CSS
		if (!document.querySelector('link[href*="driver.css"]')) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href =
				'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.css';
			document.head.appendChild(link);
		}

		// Check if script is already loaded
		if (window.driver && window.driver.js && window.driver.js.driver) {
			resolve();
			return;
		}

		const script = document.createElement('script');
		script.src =
			'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.js.iife.js';
		script.onload = () => {
			if (window.driver && window.driver.js && window.driver.js.driver) {
				resolve();
			} else {
				reject(
					new Error('Driver.js global object not found after loading')
				);
			}
		};
		script.onerror = () => reject(new Error('Failed to load Driver.js script'));
		document.body.appendChild(script);
	});
}

/**
 * Path check helper for teacher-oriented views
 */
function shouldShowHelpTour(pathname) {
	// Never show the tour on login or register pages
	const unauthPaths = ['/', '/login', '/register', '/teacher-register', '/student-register'];
	if (unauthPaths.includes(pathname.replace(/\/$/, ''))) {
		return false;
	}

	const teacherPaths = [
		'/teacher-dashboard',
		'/task-details',
		'/task-set-overview',
		'/task-statistics',
		'/student-attempts',
		'/student-task-statistics',
		'/global-statistics',
		'/create-task',
		'/create-task-editor',
		'/create-task-set',
		'/teacher/profile',
	];

	if (teacherPaths.some((p) => pathname.startsWith(p))) return true;

	// Student Task Set
	if (pathname.match(/^\/[^/]+\/set\/[^/]+(?:\/tasks)?\/?$/)) return true;

	// Student Task Problem Page
	if (pathname.match(/^\/[^/]+\/set\/[^/]+\/tasks\/(?:\d+|demo)(?:\/start)?\/?$/)) return true;

	return false;
}

/**
 * Return Driver.js steps configured specifically for the active pathname
 */
function getTourStepsForPath(pathname) {
	// Student Task Set Tour
	if (pathname.match(/^\/[^/]+\/set\/[^/]+(?:\/tasks)?\/?$/)) {
		const steps = [
			{
				element: 'h2.mb-3',
				popover: {
					title: 'Task Set',
					description:
						'Welcome to your task set! This is where you can view and access all the exercises assigned to you.',
					side: 'bottom',
				},
			},
			{
				element: '.task_set-sidebar',
				popover: {
					title: 'Progress & Info',
					description:
						'Track your completion progress and read any instructions or descriptions provided by your teacher.',
					side: 'right',
				},
			},
			{
				element: '#problems-list',
				popover: {
					title: 'Exercises List',
					description:
						'Here are all the tasks in this set. Click on any task card to start or continue working on it.',
					side: 'top',
				},
			},
		];

		// Check for warm-up demo section
		const demoCard = document.querySelector(
			'#problems-list .task-sets-column > div:first-child .task-set-item'
		);
		if (demoCard && demoCard.querySelector('.task-set-item-number')?.textContent === '★') {
			steps.push({
				element: demoCard,
				popover: {
					title: 'Warm-up Exercise',
					description:
						'This is an optional demo exercise to help you get familiar with how to solve Parsons problems.',
					side: 'right',
				},
			});
		}

		// First actual task
		const firstTaskCard = document.querySelector(
			'#problems-list .task-sets-column > .task-set-item'
		);
		if (firstTaskCard) {
			steps.push({
				element: firstTaskCard,
				popover: {
					title: 'Task Status',
					description:
						'Each task shows its completion status. Tasks you have successfully completed will be marked with a green checkmark. <strong>It is highly suggested to fully complete a task before moving on to the next one!</strong>',
					side: 'right',
				},
			});
		}

		steps.push({
			element: '#profile-link',
			popover: {
				title: 'Your Profile',
				description:
					'Click here to view your profile, manage your account, or see your overall statistics.',
				side: 'left',
			},
		});

		return steps;
	}

	// Student Task Problem Tour
	if (pathname === '/task' || pathname.match(/^\/[^/]+\/set\/[^/]+\/tasks\/(?:\d+|demo)(?:\/start)?\/?$/)) {
		const steps = [
			{
				element: 'problem-element .col-lg-9 .top-info-card',
				popover: {
					title: 'Problem Description',
					description:
						'Here you will find the instructions, rules, and examples for this programming task.',
					side: 'bottom',
				},
			},
			{
				element: 'problem-element .starter',
				popover: {
					title: 'Available Blocks',
					description:
						'These are the code blocks you can use to build your solution. Drag them into the solution area on the right.',
					side: 'right',
				},
			},
			{
				element: 'problem-element .solution',
				popover: {
					title: 'Solution Area',
					description:
						'Construct your final answer here by dropping the blocks in the correct order and indentation.',
					side: 'left',
				},
			}
		];

		// Check for faded !BLANK inputs
		const blankInput = document.querySelector('problem-element input.text-box');
		if (blankInput) {
			steps.push({
				element: blankInput,
				popover: {
					title: 'Fill-in-the-Blanks',
					description:
						'Some exercises contain faded blocks! You will need to click on these blank input fields and type the correct code to complete the block.',
					side: 'top',
				},
			});
		}

		// Check for helper blocks like DEBUG or comments
		const helperBlock = Array.from(document.querySelectorAll('problem-element .sortable-code li')).find(li =>
			li.textContent.includes('DEBUG') || li.textContent.includes('#')
		);

		if (helperBlock) {
			steps.push({
				element: helperBlock,
				popover: {
					title: 'Helper Blocks',
					description:
						'Blocks like "DEBUG" prints or comments (#) are optional. They are not required to solve the problem, but you can add them to your solution to test and understand your code!',
					side: 'top',
				},
			});
		}

		steps.push(
			{
				element: 'problem-element button.btn-primary',
				popover: {
					title: 'Check Code',
					description:
						'Once you are happy with your solution, click this button to run the tests and check your code.',
					side: 'top',
				},
			},
			{
				element: 'problem-element .test-results-card',
				popover: {
					title: 'Feedback Area',
					description:
						'Any error messages, test results, or helpful hints will appear here after you run your code.',
					side: 'left',
				},
			}
		);

		return steps;
	}

	// Dashboard Tour
	if (pathname.startsWith('/teacher-dashboard')) {
		const dashboardSteps = [
			{
				element: '.page-header',
				popover: {
					title: 'Teacher Dashboard',
					description:
						'Welcome to your main workspace! Here you can create tasks, manage your task sets, and monitor student progress.',
					side: 'bottom',
				},
			},
		];

		// Check if admin dashboard button is visible
		const adminBtn = document.getElementById('all-sets-button');
		if (adminBtn && window.getComputedStyle(adminBtn).display !== 'none') {
			dashboardSteps.push({
				element: '#all-sets-button',
				popover: {
					title: 'Admin Controls',
					description:
						'As an administrator, click here to access the Admin Dashboard to manage users, task sets and see usage data.',
					side: 'bottom',
				},
			});
		}

		dashboardSteps.push(
			{
				element: '#global-stats-btn',
				popover: {
					title: 'Task Database',
					description:
						'Access all public tasks, view statistics and find the right tasks for your own task sets.',
					side: 'bottom',
				},
			},
			{
				element: '#instructions-btn',
				popover: {
					title: 'Help Documentation',
					description:
						'Access the general more detailed instructions for using the Parsons Code Lab.',
					side: 'bottom',
				},
			},
			{
				element: '#task-sets-container',
				popover: {
					title: 'My Task Sets',
					description:
						'Here are all the task sets you have created or have been shared with you. Search for a specific task set by task set title.',
					side: 'right',
				},
			}
		);

		// Conditional step: highlight first created task set if it exists
		const firstTaskSetItem = document.querySelector(
			'#task-sets-container .task-set-item'
		);
		if (firstTaskSetItem) {
			dashboardSteps.push({
				element: firstTaskSetItem,
				popover: {
					title: 'Created Task Set',
					description:
						'Here is one of your created task sets. Click it to access the task set overview, or copy the URL to share it with your students.',
					side: 'right',
				},
			});
		}

		dashboardSteps.push({
			element: '#your-tasks-container',
			popover: {
				title: 'My Tasks List',
				description:
					'View, edit, and preview all the individual programming tasks you have created. Tasks can be edited or deleted if they are not yet in use.',
				side: 'left',
			},
		});

		// Conditional step: highlight first created task if it exists
		const firstTaskItem = document.querySelector(
			'#your-tasks-container .task-set-item'
		);
		if (firstTaskItem) {
			dashboardSteps.push({
				element: firstTaskItem,
				popover: {
					title: 'Created Task',
					description:
						'Here is one of your created tasks. Click it to preview the task how students will see it. You can also edit or delete it if not in use, or access the Global statistics of the task(not limited to your students).',
					side: 'left',
				},
			});
		}

		dashboardSteps.push({
			element: '.navbar .ml-auto',
			popover: {
				title: 'Account Settings',
				description:
					'Change profile settings, access all quick links, or sign out of your account.',
				side: 'left',
			},
		});

		return dashboardSteps;
	}

	// Task Set Overview Tour
	if (pathname.startsWith('/task-set-overview')) {
		const steps = [
			{
				element: '.taskset-page-title',
				popover: {
					title: 'Task Set Title',
					description:
						'Welcome to your task set! Here you can view and manage your task set, student enrollments, and performance data.',
					side: 'bottom',
				},
			},
			{
				element: '.taskset-link-box',
				popover: {
					title: 'Student Join Link',
					description:
						'Share this unique link with your students so they can join this task set and start working on exercises.',
					side: 'bottom',
				},
			},
			{
				element: '.taskset-meta-row',
				popover: {
					title: 'Opening & Expiry Dates',
					description:
						'View or configure when this task set opens for students and when it expires.',
					side: 'bottom',
				},
			},
			{
				element: '.csv-buttons-group',
				popover: {
					title: 'Download CSVs',
					description:
						'Export detailed timing statistics or a summary table of student completion data as CSV files.',
					side: 'bottom',
				},
			},
			{
				element: '.header-viewers',
				popover: {
					title: 'Shared Viewers',
					description:
						'Manage viewing permissions for co-teachers to grant them read-only access to student progress in this task set.',
					side: 'bottom',
				},
			},
			{
				element: '.descriptions-wrapper',
				popover: {
					title: 'Notes & Instructions',
					description:
						'Read or edit <strong>Teacher Notes</strong> (private to teachers) and <strong>Student Instructions</strong> (shown to students).',
					side: 'bottom',
				},
			},
			{
				element: '.header-stats',
				popover: {
					title: 'Statistics & Progress',
					description:
						'Quick overview of enrolled students, task counts, average progress, total attempt count, and student progression breakdown.',
					side: 'bottom',
				},
			},
			{
				element: '#toggle-lists',
				popover: {
					title: 'Tasks & Students View Toggle',
					description:
						'Switch to the primary view displaying the list of tasks and enrolled students.',
					side: 'bottom',
				},
				onHighlightStarted: () => {
					document.getElementById('toggle-lists')?.click();
				},
			},
			{
				element: '#tasks-list',
				popover: {
					title: 'Tasks List',
					description:
						'View all tasks in this set. Click any task to inspect its detailed statistics. In edit mode, you can add tasks, drag to reorder or deactivate tasks.',
					side: 'right',
				},
			},
			{
				element: '#students-list',
				popover: {
					title: 'Students List',
					description:
						'View enrolled students. Click on any student to open their detailed attempt breakdown.',
					side: 'left',
				},
			},
			{
				element: '#toggle-heatmap',
				popover: {
					title: 'Heatmap View Toggle',
					description:
						'Click here to switch to the Completion Heatmap view.',
					side: 'bottom',
				},
			},
			{
				element: '#heatmap-container',
				popover: {
					title: 'Completion Heatmap',
					description:
						'Visual matrix showing student status across all tasks (completed, in progress, struggling, not started). Hover or click any cell for details.',
					side: 'top',
				},
				onHighlightStarted: () => {
					document.getElementById('toggle-heatmap')?.click();
				},
			},
			{
				element: '.navbar .ml-auto',
				popover: {
					title: 'Account Settings',
					description:
						'Access profile settings, navigation shortcuts, or log out of your account.',
					side: 'left',
				},
			},
		];

		return steps.filter((step) => {
			if (typeof step.element === 'string') {
				return document.querySelector(step.element) !== null;
			}
			return true;
		});
	}



	// Exercise Analytics Tour
	if (pathname.startsWith('/task-statistics')) {
		const steps = [
			{
				element: '.page-header',
				popover: {
					title: 'Exercise Analytics',
					description:
						'Welcome to the Exercise Analytics page! Here you can analyze student attempts, completion rates, time spent, common mistakes, and more.',
					side: 'bottom',
				},
			},
		];

		// Check if sidebar is visible
		const sidebar = document.querySelector('.student-sidebar');
		if (sidebar && window.getComputedStyle(sidebar).display !== 'none') {
			steps.push({
				element: '.student-sidebar',
				popover: {
					title: 'Student Overview Sidebar',
					description:
						"This sidebar lists all enrolled students grouped by their completion status: <b>Completed</b>, <b>Not Yet Completed</b>, or <b>Not Started</b>. Click a student's name to view their individual attempts.",
					side: 'right',
				},
			});
		}

		steps.push(
			{
				element: '.kpi-strip',
				popover: {
					title: 'Key Performance Indicators',
					description:
						'Quickly see high-level statistics from this task.',
					side: 'bottom',
				},
			},
			{
				element: '#time-toggle-container',
				popover: {
					title: 'Time Metric Toggle',
					description:
						'Switch time metrics. <b>Total / Wall-clock</b> time is a absolute value from the start of the task to the completion timestamp, including time when the task was not open in the browser. <b>Active / On-page</b> time only measures the time the student had the task open in their browser (and not inactive for more then 30min).',
					side: 'bottom',
				},
			}
		);

		// Check if time metric shows raw numbers (insufficient data for box plot)
		const showsNumbers = document.querySelector(
			'.time-metric:not(:has(.bp-svg-wrap))'
		);
		if (showsNumbers) {
			steps.push({
				element: '.time-metric:not(:has(.bp-svg-wrap))',
				popover: {
					title: 'Time Metrics (Text View)',
					description:
						'When there are fewer than 5 attempts, there is insufficient data to construct a box plot. Instead, this section shows the raw <b>minimum</b>, <b>median</b>, <b>average</b>, and <b>maximum</b> values directly.',
					side: 'top',
				},
			});
		}

		// Check if time metric shows box plot
		const showsBoxPlot = document.querySelector(
			'.time-metric:has(.bp-svg-wrap)'
		);
		if (showsBoxPlot) {
			steps.push({
				element: '.time-metric:has(.bp-svg-wrap)',
				popover: {
					title: 'Time Metrics (Box Plot View)',
					description:
						'With 5 or more attempts, this interactive <b>Box Plot</b> is generated showing the distribution of time or moves:<br>- <b>Box</b>: Middle 50% of students.<br>- <b>Vertical Line</b>: Median value.<br>- <b>Diamond</b>: Average (mean) value.<br>- <b>Whiskers</b>: Outlier limits.<br>- <b>Dots</b>: Individual outliers. Hovering shows accurate time stamps.',
					side: 'top',
				},
			});
		}

		steps.push({
			element: '.completion-card',
			popover: {
				title: 'Completion Details',
				description:
					'Displays a visual breakdown of completion status, average/min/max attempts to pass, and page exits (how often students left the task tab).',
				side: 'left',
			},
		});

		// Check if mistakes box is visible
		const mistakesBox = document.getElementById('mistakes-box');
		if (
			mistakesBox &&
			window.getComputedStyle(mistakesBox).display !== 'none'
		) {
			steps.push({
				element: '#mistakes-box',
				popover: {
					title: 'Most Common Mistakes',
					description:
						'Lists the five most frequently submitted incorrect solutions, helping you identify common mistakes.',
					side: 'top',
				},
			});
		}

		steps.push({
			element: '#model-answer-box',
			popover: {
				title: 'Model Answer',
				description:
					'Shows the model answer set for this task. Note: there can be more then one correct answer to some tasks.',
				side: 'top',
			},
		});

		// Check if custom errors box is visible
		const customErrorsBox = document.getElementById('custom-errors-box');
		if (
			customErrorsBox &&
			window.getComputedStyle(customErrorsBox).display !== 'none'
		) {
			steps.push({
				element: '#custom-errors-box',
				popover: {
					title: 'Custom Error Messages',
					description:
						'Displays custom feedback and hints configured for specific incorrect student submissions.',
					side: 'top',
				},
			});
		}

		return steps;
	}

	// Student Attempts Tour
	if (pathname.startsWith('/student-attempts')) {
		const steps = [
			{
				element: '#page-header',
				popover: {
					title: 'Student Attempts Overview',
					description:
						'This page shows all task attempts and overall progress statistics for a specific student in this task set.',
					side: 'bottom',
				},
			},
		];

		// Check if remove student button is visible
		const removeBtn = document.getElementById('remove-student-btn');
		if (removeBtn) {
			steps.push({
				element: '#remove-student-btn',
				popover: {
					title: 'Remove Student',
					description:
						'Click this button to completely remove this student and all of their progress data from this task set. <b>Warning:</b> This action is permanent and cannot be undone.',
					side: 'bottom',
				},
			});
		}

		steps.push(
			{
				element: '#completion-panel',
				popover: {
					title: 'Progress Breakdown',
					description:
						"This card contains a donut chart and a legend detailing the student's progress: how many tasks they have <b>Completed</b>, <b>Not completed</b> (attempted but not yet passed), and <b>Not started</b>.",
					side: 'right',
				},
			},
			{
				element: '#attempts-list',
				popover: {
					title: 'Tasks Attempted',
					description:
						"A list of all the tasks the student has attempted in this set. Each card shows the task title, success status, attempt count, and last attempt timestamp. <b>Clicking on any card</b> will navigate you to the student's detailed workspace and code execution history for that task.",
					side: 'left',
				},
			}
		);

		return steps;
	}

	// Student Task Statistics Tour
	if (pathname.startsWith('/student-task-statistics')) {
		const steps = [
			{
				element: '#content-header',
				popover: {
					title: 'Student Attempt Review',
					description:
						"Review a specific student's attempt statistics and solve history for this particular task.",
					side: 'bottom',
				},
			},
			{
				element: '#student-name-badge',
				popover: {
					title: 'Student Profile Link',
					description:
						"Displays the student's username. Clicking this badge navigates you to their general attempt history for this task set.",
					side: 'bottom',
				},
			},
		];

		// Check if instructions are visible
		const instructionsContent = document.getElementById(
			'task-instructions-content'
		);
		if (instructionsContent && instructionsContent.innerHTML.trim() !== '') {
			steps.push({
				element: '#task-instructions-box',
				popover: {
					title: 'Task Instructions',
					description:
						'Shows the problem description, rules, and example inputs/outputs that were given to the student.',
					side: 'bottom',
				},
				onHighlightStarted: () => {
					const body = document.getElementById('instructions-body');
					if (body && body.classList.contains('collapsed')) {
						document.getElementById('instructions-toggle')?.click();
					}
				},
			});
		}

		steps.push(
			{
				element: '.summary-strip',
				popover: {
					title: 'Summary Metrics',
					description:
						"High-level summary of the student's performance on this task: total attempts, success/fail count, and total active time spent.",
					side: 'bottom',
				},
			},
			{
				element: '#attempts-list',
				popover: {
					title: 'All Code Submissions',
					description:
						'Lists every single submission made by the student in chronological order. Each entry shows the time, success status, and the exact code blocks they submitted.',
					side: 'right',
				},
				onHighlightStarted: () => {
					const body = document.getElementById('attempts-body');
					if (body && body.classList.contains('collapsed')) {
						document.getElementById('attempts-toggle')?.click();
					}
				},
			},
			{
				element: '#replay-body',
				popover: {
					title: 'Interactive Replay Player',
					description:
						"This interactive tool allows you to replay the student's entire block-solving process step-by-step. Use the slider and play buttons to see exactly how they constructed and edited their code blocks.",
					side: 'right',
				},
				onHighlightStarted: () => {
					const body = document.getElementById('replay-body');
					if (body && body.classList.contains('collapsed')) {
						document.getElementById('replay-toggle')?.click();
					}
				},
			},
			{
				element: '#time-toggle-container',
				popover: {
					title: 'Active vs. Wall-Clock Time Toggle',
					description:
						'Use this toggle to switch the time metrics displayed below between:<br>- <b>Active / On-page</b>: Only counts time when the student actively focused on the exercise tab.<br>- <b>Total / Wall-clock</b>: Includes time when the student had other tabs/windows open.',
					side: 'bottom',
				},
			},
			{
				element: '.metric-grid',
				popover: {
					title: 'Detailed Time & Move Metrics',
					description:
						'Displays precise time measurements (Time to First Success, Time to First Fail, Thinking Time) and interactions (Moves Made, Page Exits) for this student.',
					side: 'left',
				},
			},
			{
				element: '#sessions-body',
				popover: {
					title: 'Active Work Sessions',
					description:
						'Displays a timeline of active sessions: when the student opened the task, how long they worked, and why they left (e.g. timeout or closed tab).',
					side: 'left',
				},
				onHighlightStarted: () => {
					const body = document.getElementById('sessions-body');
					if (body && body.classList.contains('collapsed')) {
						document.getElementById('sessions-toggle')?.click();
					}
				},
			},
			{
				element: '#model-body',
				popover: {
					title: 'Model Answer Solution',
					description:
						'Shows the reference correct solution of this programming exercise for easy comparison.',
					side: 'top',
				},
				onHighlightStarted: () => {
					const body = document.getElementById('model-body');
					if (body && body.classList.contains('collapsed')) {
						document.getElementById('model-toggle')?.click();
					}
				},
			}
		);

		return steps;
	}

	// Task Details Tour
	if (pathname.startsWith('/task-details')) {
		const steps = [
			{
				element: '.page-header',
				popover: {
					title: 'Task Details Overview',
					description:
						'Welcome to Task Details! Here you can review all instructions, code blocks, model answer, test assertions, and error rules for this task.',
					side: 'bottom',
				},
			},
			{
				element: '.dashboard-main > .d-flex.justify-content-end',
				popover: {
					title: 'Task Actions',
					description:
						'Use these quick actions to edit the task (if editable), solve the exercise as a student, or view its global statistics.',
					side: 'bottom',
				},
			},
			{
				element: '#details-problem-statement',
				popover: {
					title: 'Problem Statement & Examples',
					description:
						'View the full problem description, function header, and example usage provided to students.',
					side: 'right',
				},
			},
			{
				element: '#details-blocks-container',
				popover: {
					title: 'Configured Code Blocks',
					description:
						'Inspect all code blocks configured for this task, marked with clear visual badges for Solution Blocks, Distractors, or Pinned blocks.',
					side: 'right',
				},
			},
			{
				element: '#details-model-code',
				popover: {
					title: 'Model Answer',
					description:
						'Shows the reference python solution code expected for this task.',
					side: 'left',
				},
			},
			{
				element: '#details-tests-code',
				popover: {
					title: 'Written Tests',
					description:
						'Displays the automated Python assertions/tests used to grade student code submissions.',
					side: 'left',
				},
			},
			{
				element: '#details-err-container',
				popover: {
					title: 'Custom Error Messages',
					description:
						'Lists custom error feedback and hint rules configured for specific student mistakes.',
					side: 'left',
				},
			},
		];

		return steps;
	}

	// Task Database Tour
	if (pathname.startsWith('/global-statistics')) {
		const steps = [
			{
				element: '.page-header',
				popover: {
					title: 'Task Database',
					description:
						'Welcome to the Task Database page! Here you can search and filter all public exercises, preview tasks, and view their anonymous global statistics.',
					side: 'bottom',
				},
			},
			{
				element: '#task-filter-toggle',
				popover: {
					title: 'Search & Filter Panel',
					description:
						'Click this button to open the Search & Filter panel to narrow down the list of exercises.',
					side: 'bottom',
				},
			},
			{
				element: '#task-search',
				popover: {
					title: 'Search Tasks',
					description:
						'Type here to search tasks. By default, it searches in title, type, and teacher fields.',
					side: 'bottom',
				},
				onHighlightStarted: () => {
					const panel = document.getElementById('task-filter-panel');
					if (panel && !panel.classList.contains('show')) {
						document.getElementById('task-filter-toggle')?.click();
					}
				},
			},
			{
				element: '.filter-scopes',
				popover: {
					title: 'Filter Scopes',
					description:
						'Select a scope to search in specific fields (e.g. only Title, Teacher, or Type). You can also filter to view only your own exercises or your starred favorites.',
					side: 'bottom',
				},
				onHighlightStarted: () => {
					const panel = document.getElementById('task-filter-panel');
					if (panel && !panel.classList.contains('show')) {
						document.getElementById('task-filter-toggle')?.click();
					}
				},
			},
			{
				element: '#problems-list',
				popover: {
					title: 'Exercises List',
					description:
						'This is where all available exercises are listed. Clicking an exercise card opens its full details view, and hovering over a card previews it.',
					side: 'top',
				},
			},
		];

		const previewCol = document.querySelector('.gs-preview-col');
		if (previewCol) {
			steps.push({
				element: '.gs-preview-col',
				popover: {
					title: 'Quick Task Preview Panel',
					description:
						'Hovering over any task card updates this panel with a live preview of the problem statement, code blocks, model answer, and quick action links.',
					side: 'left',
				},
			});
		}

		const firstTask = document.querySelector('#problems-list .task-set-item');
		if (firstTask) {
			steps.push({
				element: firstTask,
				popover: {
					title: 'Exercise Card Actions',
					description:
						'Each exercise card lets you view <b>Global Statistics</b>, open <b>Solve Task</b> to test solving as a student, or star/favorite the task for building task sets.',
					side: 'top',
				},
			});
		}

		return steps;
	}


	// Create Task Editor (Step 2: Blocks and Details) Tour
	if (pathname.startsWith('/create-task-editor')) {
		const evalTypeInput = document.getElementById('eval-type');
		const evalType = evalTypeInput ? evalTypeInput.value : 'unit_test';

		let testsStepElement = '#unit-test-container';
		let testsStepTitle = 'Check Tests (Unit Tests)';
		let testsStepDesc = 'Review or edit test cases and click "Run Tests" to verify your model answer.';

		if (evalType === 'stdout') {
			testsStepElement = '#stdout-container';
			testsStepTitle = 'Expected Output';
			testsStepDesc = 'Review expected print output and click "Run Tests" to verify your model answer.';
		} else if (evalType === 'order_only') {
			testsStepElement = '#order-only-container';
			testsStepTitle = 'Order Only (No Tests Required)';
			testsStepDesc = 'No code execution required! The task is automatically verified against the model block order.';
		}

		return [
			{
				element: '.checklist-sidebar',
				popover: {
					title: 'Task Checklist',
					description:
						'Keep track of the remaining requirements before your task is ready to be saved.',
					side: 'right',
				},
			},
			{
				element: '#task-title',
				popover: {
					title: 'Task Title',
					description:
						'Give your task a clear, descriptive name that will be displayed in task sets.',
					side: 'bottom',
				},
			},
			{
				element: '#start-description',
				popover: {
					title: 'Start Page Intro',
					description:
						'Provide a brief introduction for students that will appear on the task start page before they begin. Do not give the entire description since this can be read before the timer starts.',
					side: 'bottom',
				},
			},
			{
				element: '#problem-description',
				popover: {
					title: 'Problem Statement',
					description:
						'Write clear instructions and problem requirements for students to read while solving the task. It is advised to also add an example of how the program should work.',
					side: 'bottom',
				},
			},
			{
				element: '.builder-layout',
				popover: {
					title: 'Block Builder & Model Answer',
					description:
						'Drag blocks to the right column to construct the model answer. Leave distractor blocks on the left. Double-click a block on the right to pin it as pre-given.',
					side: 'top',
				},
			},
			{
				element: '#set-model-answer',
				popover: {
					title: 'Set Model Answer',
					description:
						'Click this button to save the current right-column block arrangement as the official correct answer.',
					side: 'top',
				},
			},
			{
				element: '.custom-block-box',
				popover: {
					title: 'Add Custom Blocks',
					description:
						'Create additional code blocks or distractors. You can use <code>!BLANK</code> to create faded editable fill-in-the-blank blocks.',
					side: 'top',
				},
			},
			{
				element: testsStepElement,
				popover: {
					title: testsStepTitle,
					description: testsStepDesc,
					side: 'top',
				},
			},
			{
				element: '#custom-error-messages',
				popover: {
					title: 'Custom Error Messages',
					description:
						'Configure custom feedback or hints in JSON format that will be shown to students when their code produces specific errors or outputs.',
					side: 'top',
				},
			},
			{
				element: '#task-type',
				popover: {
					title: 'Task Tag',
					description:
						'Select the task tag that best matches the main programming concept or topic.',
					side: 'bottom',
				},
			},
			{
				element: '.visibility-card',
				popover: {
					title: 'Task Visibility',
					description:
						'By default, tasks are public and shared with the teacher community. Check this box if you want to make the task private.',
					side: 'bottom',
				},
			},
			{
				element: '.actions',
				popover: {
					title: 'Preview and Save',
					description:
						'Preview the task to see how it looks to students, then save it to publish it to your dashboard.',
					side: 'top',
				},
			},
		];
	}

	// Create Task (Step 1: Code and Tests) Tour
	if (
		pathname.startsWith('/create-task') &&
		!pathname.startsWith('/create-task-editor') &&
		!pathname.startsWith('/create-task-set')
	) {
		const evalTypeInput = document.getElementById('eval-type');
		const evalType = evalTypeInput ? evalTypeInput.value : 'unit_test';

		const steps = [
			{
				element: '.page-title',
				popover: {
					title: 'Create a New Task',
					description:
						'Welcome to the Task Creator! Here you can write the initial Python code and tests for your new exercise.',
					side: 'bottom',
				},
			},
			{
				element: '#guide-toggle',
				popover: {
					title: 'How to Create a Task Guide',
					description:
						'Click here anytime to view step-by-step guides and ready-to-copy examples for all 3 task types (Function Unit Tests, Console Output, and Order Only).',
					side: 'bottom',
				},
			},
			{
				element: '#eval-type',
				popover: {
					title: 'Evaluation Mode',
					description:
						'Choose your task type:<br>- <b>Function Unit Tests</b>: Standard function code tested with assert statements.<br>- <b>Console Output (print)</b>: Code printing text matched against expected output.<br>- <b>Order Only</b>: Scrambled conceptual steps graded on sequence without code execution.',
					side: 'bottom',
				},
			},
			{
				element: '#task-code',
				popover: {
					title: 'Task Code Editor',
					description:
						evalType === 'stdout'
							? 'Write Python code that outputs text using print statements.'
							: evalType === 'order_only'
							? 'Write the scrambled lines or conceptual steps in correct order (one per line).'
							: 'Write the reference Python function that defines the task students need to solve.',
					side: 'right',
				},
			},
		];

		if (evalType !== 'order_only') {
			steps.push({
				element: '#task-tests-panel',
				popover: {
					title: evalType === 'stdout' ? 'Expected Output Editor' : 'Task Tests Editor',
					description:
						evalType === 'stdout'
							? 'Enter the exact string expected to be printed by the code.'
							: 'Write Python unit tests (like assert statements) to verify student solutions.',
					side: 'left',
				},
			});
		}

		steps.push({
			element: '#submit-task',
			popover: {
				title: 'Continue to Block Builder',
				description:
					'Once your task code and tests are configured, click here to move on to Step 2: Block Builder.',
				side: 'top',
			},
		});

		return steps;
	}

	// Create Task Set Tour
	if (pathname.startsWith('/create-task-set')) {
		return [
			{
				element: '.page-header',
				popover: {
					title: 'Create Task Set',
					description:
						'Welcome to the Task Set Creator! Here you can group programming tasks into a set, configure descriptions, expiration dates, and share permissions.',
					side: 'bottom',
				},
			},
			{
				element: '#task-set-title',
				popover: {
					title: 'Task Set Title',
					description:
						'Give your task set a clear, descriptive name (e.g., course code ) to show to students and fellow teachers.',
					side: 'bottom',
				},
			},
			{
				element: '#student-description',
				popover: {
					title: 'Student Description',
					description:
						'Provide notes or instructions that will be visible to students on the start page of this task set.',
					side: 'bottom',
				},
			},
			{
				element: '#teacher-description',
				popover: {
					title: 'Teacher Description',
					description:
						'Add private notes or instructions for yourself and other co-teachers. Students will never see this.',
					side: 'bottom',
				},
			},
			{
				element: '#viewer-identifiers',
				popover: {
					title: 'Share Viewing Rights',
					description:
						'Enter the username or email of another teacher to grant them read-only permissions to view student completions and data for this set.',
					side: 'bottom',
				},
			},
			{
				element: '.checkbox-custom',
				popover: {
					title: 'Expiration Date',
					description:
						'Check this box to set a deadline. Once expired, students will no longer be allowed to join or submit attempts.',
					side: 'bottom',
				},
			},
			{
				element: '.task-filter-menu',
				popover: {
					title: 'Search & Filter Tasks',
					description:
						'Search for public or favorited tasks by title, author, or scope to add them to your set.',
					side: 'bottom',
				},
			},
			{
				element: '#task-selector',
				popover: {
					title: 'Available Tasks List',
					description:
						'This list displays all available tasks matching your search. Check the box on a task card to select it or click the preview to look what the task is.',
					side: 'top',
				},
			},
			{
				element: '#selected-tasks-list',
				popover: {
					title: 'Selected Tasks & Reordering',
					description:
						'Displays all currently selected tasks. You can drag and drop tasks to change the order. Students will see this order, but this does not force students to do them in this order.',
					side: 'top',
				},
			},
			{
				element: '.button-group',
				popover: {
					title: 'Save or Cancel',
					description:
						'Click "Create Task Set" to save and publish your new task set, or click "Cancel" to discard changes.',
					side: 'top',
				},
			},
		];
	}

	// Fallback Tour
	return [
		{
			element: '.navbar',
			popover: {
				title: 'Need Help?',
				description:
					'Access the global menu or navigate to the comprehensive instructions manual for complete guidance.',
				side: 'bottom',
			},
		},
	];
}

async function launchHelpTour(triggerBtn) {
	if (triggerBtn) {
		triggerBtn.disabled = true;
		if (triggerBtn.id === 'floating-help-btn') {
			triggerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
		}
	}
	try {
		await loadDriverJSAndCSS();
		const driverObj = window.driver.js.driver({
			showProgress: true,
			steps: getTourStepsForPath(window.location.pathname),
		});
		driverObj.drive();
	} catch (err) {
		console.error('Failed to launch help tour:', err);
	} finally {
		if (triggerBtn) {
			triggerBtn.disabled = false;
			if (triggerBtn.id === 'floating-help-btn') {
				triggerBtn.innerHTML = '<i class="fas fa-question"></i>';
			}
		}
	}
}

/**
 * Injects and initializes the global tour widget
 */
function initGlobalHelpTour() {
	if (!shouldShowHelpTour(window.location.pathname)) {
		return;
	}

	// Bind any static menu tour triggers if present in DOM
	const menuTourBtn = document.getElementById('start-tour-menu-item');
	if (menuTourBtn && !menuTourBtn.dataset.tourBound) {
		menuTourBtn.dataset.tourBound = 'true';
		menuTourBtn.addEventListener('click', (e) => {
			e.preventDefault();
			launchHelpTour(menuTourBtn);
		});
	}

	// Check if floating button is already injected
	if (document.getElementById('floating-help-btn')) {
		return;
	}

	// Injects style
	const style = document.createElement('style');
	style.textContent = `
		.floating-help-btn {
			position: fixed;
			bottom: 24px;
			right: 24px;
			width: 48px;
			height: 48px;
			border-radius: 50%;
			background: #2b2b2b;
			color: #ffffff;
			border: 2px solid #ffffff;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 1.1rem;
			z-index: 9999;
			transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
		}
		.floating-help-btn:hover {
			background: #111111;
			transform: scale(1.08);
			box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
			outline: none;
		}
		.floating-help-btn:focus {
			outline: none;
		}
	`;
	document.head.appendChild(style);

	// Injects button
	const btn = document.createElement('button');
	btn.id = 'floating-help-btn';
	btn.className = 'floating-help-btn';
	btn.title = 'Start Help Tour';
	btn.innerHTML = '<i class="fas fa-question"></i>';
	document.body.appendChild(btn);

	btn.addEventListener('click', () => {
		launchHelpTour(btn);
	});
}

// Automatically bind to DOMContentLoaded to run dynamic widget injection
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initGlobalHelpTour);
} else {
	initGlobalHelpTour();
}
