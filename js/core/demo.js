import { initStudentLogout, initSignedInAs, initBurgerMenu } from '../core/auth-ui.js';
import {
	prepareCode,
	processTestResults,
	processTestError,
} from '../core/doctest-grader.js';
import { FiniteWorker } from '../core/worker-manager.js';

initBurgerMenu();
initSignedInAs({ preferNickname: true });
initStudentLogout();

const params = new URL(document.location).searchParams;
let returnUrl = params.get('return') || null;

if (!returnUrl) {
	const pathParts = window.location.pathname.split('/').filter(p => p);
	if (pathParts.length >= 4 && pathParts[1] === 'set' && pathParts[3] === 'tasks') {
		const username = pathParts[0];
		const uniqueLinkCode = pathParts[2];
		returnUrl = `/${username}/set/${uniqueLinkCode}/tasks`;
	}
}

const backBtn = document.getElementById('back-to-list');
if (backBtn) {
	backBtn.href = returnUrl || localStorage.getItem('last_task_set_url') || '/';
	backBtn.style.display = 'inline-block';
}

const EXPECTED_OUTPUT = 'Hello, World!\nWelcome to Parsons Code Lab!';

const BLOCKS = [
	{ code: 'print("Hello, World!")', indent: 0, given: false },
	{ code: 'print("Welcome to Parsons Code Lab!")', indent: 0, given: false },
];

function buildCodeLines(blocks) {
	const lines = blocks.map((b) => {
		const indent = '    '.repeat(b.indent);
		return indent + b.code + (b.given ? ` #${b.indent}given` : '');
	});
	return lines.join('\n');
}

// Instructions modal
const modal = document.createElement('div');
modal.style.cssText = [
	'display:none',
	'position:fixed',
	'inset:0',
	'background:rgba(0,0,0,0.5)',
	'z-index:9999',
	'justify-content:center',
	'align-items:center',
].join(';');
modal.innerHTML = `
	<div style="background:#fff;border-radius:10px;padding:2rem;max-width:540px;width:90%;
	            box-shadow:0 8px 32px rgba(0,0,0,0.2);position:relative;max-height:90vh;overflow-y:auto;">
		<button onclick="window.__closeDemoModal()"
		        style="position:absolute;top:0.75rem;right:1rem;background:none;border:none;
		               font-size:1.4rem;line-height:1;cursor:pointer;color:#6c757d;"
		        aria-label="Close">&times;</button>
		<h5 style="margin-bottom:1.25rem;">How this exercise works</h5>
		<p style="margin-bottom:0.5rem;"><strong>1. Drag the code blocks</strong></p>
		<p style="margin-bottom:1rem;color:#495057;">
			On the left you'll see two shuffled <code>print</code> statements. Drag them
			into the solution area on the right in the order that produces the expected output.
		</p>
		<p style="margin-bottom:0.5rem;"><strong>2. Run your solution</strong></p>
		<p style="margin-bottom:1rem;color:#495057;">
			When you are happy with the arrangement, click <strong>Run</strong>.
			The result will tell you whether the output is correct.
		</p>
		<p style="margin-bottom:1.5rem;color:#495057;">
			No functions, conditions, or return statements are needed for this warm-up.
		</p>
		<button onclick="window.__closeDemoModal()"
		        style="background:#007bff;color:#fff;border:none;border-radius:6px;
		               padding:0.5rem 1.25rem;cursor:pointer;font-size:0.95rem;">
			Got it
		</button>
	</div>
`;
modal.addEventListener('click', (e) => {
	if (e.target === modal) window.__closeDemoModal();
});
document.body.appendChild(modal);

window.__openDemoModal = () => { modal.style.display = 'flex'; };
window.__closeDemoModal = () => { modal.style.display = 'none'; };

const LS_DEMO_REPR = 'demo-print-order-repr';
let probEl;

async function handleSubmit(submittedCode) {
	let testResults = prepareCode(submittedCode, '', '', 'stdout');

	if (testResults.code) {
		try {
			const { results, error } = await new FiniteWorker(testResults.code);
			if (typeof results === 'string') {
				testResults = processTestResults(results, [], 'stdout', EXPECTED_OUTPUT);
			} else {
				testResults = processTestError(error, testResults.startLine);
			}
		} catch (e) {
			testResults = {
				status: 'fail',
				header: 'Unexpected error occurred',
				details: e.message || 'An unknown error occurred while running tests.',
				messageSource: 'system',
			};
		}
	}

	if (!testResults || !testResults.status) {
		testResults = {
			status: 'fail',
			header: 'Unexpected error occurred',
			details: 'No test result was produced.',
			messageSource: 'system',
		};
	}

	probEl.setAttribute('runStatus', '');
	probEl.setAttribute('resultsStatus', testResults.status);
	probEl.setAttribute('resultsHeader', testResults.header);
	probEl.setAttribute('resultsDetails', testResults.details);
	probEl.setAttribute('resultsMessageSource', testResults.messageSource || 'system');
	probEl.showNextTask = false;
	probEl.nextTaskUrl = '';
	probEl.allTasksCompleted = false;
	probEl.backToSetUrl = '';

	if (testResults.status === 'pass') {
		const finalReturnUrl = returnUrl || '/';
		probEl.nextTaskUrl = finalReturnUrl;
		probEl.showNextTask = true;
		probEl.nextTaskLabel = 'Back to task set';
	}
}

probEl = document.createElement('problem-element');
probEl.setAttribute('name', 'demo-print-order');
probEl.setAttribute(
	'taskInstructions',
	'<div>Arrange the two print statements so the program prints the expected two-line output.</div><br><br><div class="demo-info-note"><em>This warm-up focuses on using the Parsons exercise area. You do not need to know functions, conditions, or return statements yet.</em></div>'
);
probEl.setAttribute(
	'description',
	'A short warm-up exercise for arranging two print statements.'
);
probEl.setAttribute('codeLines', buildCodeLines(BLOCKS));
probEl.setAttribute('codeHeader', '');
probEl.requireIndentation = false;
probEl.setAttribute('runStatus', 'Loading Pyodide...');
probEl.shuffleStarterBlocks = true;

const savedArrangementJson = localStorage.getItem(LS_DEMO_REPR);
if (savedArrangementJson) {
	try {
		probEl.savedArrangement = JSON.parse(savedArrangementJson);
	} catch (e) {
		// Ignore malformed data
	}
}

probEl.addEventListener('run', (e) => {
	handleSubmit(e.detail.code);
});

probEl.addEventListener('arrangement-changed', (e) => {
	if (e.detail.arrangement) {
		localStorage.setItem(LS_DEMO_REPR, JSON.stringify(e.detail.arrangement));
	}
});

probEl.setAttribute('enableRun', 'enableRun');
probEl.setAttribute('runStatus', '');
probEl.showNextTask = false;
probEl.nextTaskUrl = '';

document.getElementById('problem-wrapper').appendChild(probEl);

// Insert the instructions button into the "Drag from here" label once the widget renders
const labelObserver = new MutationObserver(() => {
	const labelEl = probEl.querySelector('.sortable-code.starter p');
	if (!labelEl) return;
	labelObserver.disconnect();
	const btn = document.createElement('button');
	btn.textContent = 'How does this work?';
	btn.onclick = window.__openDemoModal;
	btn.style.cssText = [
		'display:inline',
		'margin-left:0.6rem',
		'background:none',
		'border:1px solid #0056b3',
		'color:#0056b3',
		'border-radius:5px',
		'padding:0.2rem 0.6rem',
		'cursor:pointer',
		'font-size:0.8rem',
		'vertical-align:middle',
	].join(';');
	labelEl.appendChild(btn);
});
labelObserver.observe(probEl, { childList: true, subtree: true });
