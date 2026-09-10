/* global ParsonsWidget, $ */

// Lit web component base + templating and styling utilities
import {LitElement, html} from 'lit';
// Allows rendering HTML strings safely for trusted content
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
// Ref helpers to access rendered DOM nodes
import {ref, createRef} from 'lit/directives/ref.js';

import '../components/loader-element.js';
import '../components/test-results-element.js';

// ProblemElement: UI wrapper for a single Parsons problem.
// Responsibilities:
// - Present problem description
// - Render two sortable code areas (starter & solution)
// - Handle Run action and emit a 'run' event with code payload
export class ProblemElement extends LitElement {
	static properties = {
		name: {type: String},
		attemptId: {type: String},
		taskInstructions: {type: String},
		description: {type: String},
		codeLines: {type: String},
		codeHeader: {type: String},
		evalType: {type: String},
		requireIndentation: {type: Boolean, default: true},
		isLoading: {type: Boolean},
		enableRun: {type: Boolean, default: false},
		runStatus: {type: String},
		resultsStatus: {type: String},
		resultsHeader: {type: String},
		resultsDetails: {type: String},
		resultsMessageSource: {type: String},
		resultsTeacherHint: {type: String},
		nextTaskUrl: {type: String},
		showNextTask: {type: Boolean},
		allTasksCompleted: {type: Boolean},
		backToSetUrl: {type: String},
		nextTaskLabel: {type: String},
		shuffleStarterBlocks: {type: Boolean},
	};

	// Refs to the container elements bound to the Parsons widget
	taskCardRef = createRef();
	testResultsCardRef = createRef();
	starterRef = createRef();
	solutionRef = createRef();
	leftColumnRef = createRef();
	rightColumnRef = createRef();

	// Array to store moves locally as they happen
	recordedMoves = [];

	// Array to store blank field edits locally as they happen
	recordedEdits = [];

	// Saved arrangement to restore on init (set from main.js before element mounts)
	savedArrangement = null;

	// Opt-out of Shadow DOM to allow existing CSS frameworks to style content
	createRenderRoot() {
		return this;
	}

	render() {
		let results = html`<div class="p-3 text-muted">Test results will appear here after clicking "Run Tests" above.</div>`;
		let badgeClass = '';

		const generalGuidance = html`
			<ul class="mb-0 pl-3">
				<li>Read the problem statement first and identify what the final program should do.</li>
				<li>Drag blocks from the left area into the solution area on the right.</li>
				<li>Only drag the blocks you need. Some problems use every block, others leave some unused.</li>
				<li>Run tests often and use the feedback to fix ordering, indentation, or missing lines.</li>
				<li>When all tests pass, move on to the next task.</li>
			</ul>
		`;

		if (this.resultsStatus) {
			const summaryMatch = (this.resultsHeader || '').match(/^(\d+) of (\d+) tests passed$/i);
			let summaryVariant = 'unknown';
			if (summaryMatch) {
				const passedCount = Number(summaryMatch[1]);
				const totalCount = Number(summaryMatch[2]);
				if (passedCount > 0 && passedCount === totalCount) {
					summaryVariant = 'full-pass';
				} else if (passedCount > 0) {
					summaryVariant = 'partial-pass';
				} else {
					summaryVariant = 'no-pass';
				}
			} else if ((this.resultsStatus || '').toLowerCase() === 'fail') {
				summaryVariant = 'no-pass';
			} else if ((this.resultsStatus || '').toLowerCase() === 'pass') {
				summaryVariant = 'full-pass';
			}
			badgeClass = `test-result-badge ${summaryVariant}`;

			// Render the test results component with current status
			results = html`<test-results-element
				status=${this.resultsStatus}
				header=${this.resultsHeader}
				details=${this.resultsDetails}
				source=${this.resultsMessageSource || 'system'}
				teacherhint=${this.resultsTeacherHint || ''}
			></test-results-element>`;
		}



		return html`

			<!-- Main Content Row -->
			<div class="row mt-3 flex-grow-1 align-items-stretch problem-main-row">
				<!-- Left column: Problem statement + Parsons widget -->
				<div class="col-12 col-lg-9 mb-4 mb-lg-0 d-flex flex-column" ${ref(this.leftColumnRef)}>
					<div class="card top-info-card problem-statement-card mb-3">
						<div class="card-header">
							<h3>Problem Statement</h3>
						</div>
						<div class="card-body">${unsafeHTML(this.taskInstructions)}</div>
					</div>

					<div class="card flex-grow-1 parsons-task-card" ${ref(this.taskCardRef)}>
						<div class="card-body d-flex flex-column">
							<div class="parsons-sortable-container d-flex flex-grow-1">
								<div
									${ref(this.starterRef)}
									class="sortable-code starter"
								></div>
								<div
									${ref(this.solutionRef)}
									class="sortable-code solution"
								></div>
							</div>
							<div class="row float-right mt-auto pt-3">
								<div class="col-sm-12">
									<span style="margin-right: 8px">
										${this.runStatus &&
										html`<loader-element></loader-element>`}
										${this.runStatus}
									</span>
									${this.showNextTask && this.nextTaskUrl
										? html`
											<button
												@click=${this.onNextTask}
												type="button"
												class="btn btn-success"
												style="margin-right: 8px"
											>
												${this.nextTaskLabel || 'Next task'}
											</button>
										`
										: this.allTasksCompleted && this.backToSetUrl
											? html`
												<a href=${this.backToSetUrl} class="btn btn-info" style="margin-right: 8px">
													Done
												</a>
											`
											: ''}
									<button
										@click=${this.onRun}
										type="button"
										class="btn btn-primary"
										?disabled=${!this.enableRun}
									>
										${this.evalType === 'order_only' ? 'Check Order' : (this.evalType === 'stdout' ? 'Check Output' : 'Run Tests')}
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Right column: Guidance + test results -->
				<div class="col-12 col-lg-3 d-flex flex-column" ${ref(this.rightColumnRef)}>
					
					<!-- General Guidance (Collapsible) -->
					<details class="card top-info-card guidance-details mb-3" ?open=${!this.resultsStatus}>
						<summary class="card-header guidance-summary">
							<h4 style="display: inline-block; margin: 0;">General Guidance</h4>
						</summary>
						<div class="card-body">
							${generalGuidance}
						</div>
					</details>

					<!-- Test results card -->
					<div class="card test-results-card flex-grow-1 d-flex flex-column" ${ref(this.testResultsCardRef)} style="min-height: 0;">
						<div class="card-header d-flex align-items-center justify-content-between" style="padding-right: 1rem;">
							<h4 style="margin: 0;">Test Results</h4>
							${this.resultsHeader ? html`<span class="${badgeClass}">${this.resultsHeader}</span>` : ''}
						</div>
						<div id="test_description" class="card-body d-flex flex-column p-0" style="overflow-y: auto; overflow-x: hidden;">
							${results}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	recordBlockMove = (moveData) => {
		// Store move locally instead of sending to server immediately
		this.recordedMoves.push(moveData);
		this.dispatchEvent(new CustomEvent('arrangement-changed', {
			detail: { arrangement: this.getCurrentArrangement() },
			bubbles: true,
		}));
	};

	// Returns a stable arrangement snapshot: solution block IDs (in order),
	// indent levels, and blank values. Block IDs here are always the original
	// sortable-codelineN IDs from the first fresh init, so they stay consistent
	// with what the replay's initial_blocks uses.
	getCurrentArrangement = () => {
		if (!this.parsonsWidget || !this.solutionRef.value) return null;
		const solutionUl = this.solutionRef.value.querySelector('ul');
		if (!solutionUl) return null;

		const solutionIds = Array.from(solutionUl.querySelectorAll('li[id]')).map(li => li.id);
		const indents = {};
		const blanks = {};

		for (const id of solutionIds) {
			const line = this.parsonsWidget.getLineById(id);
			if (line) indents[id] = line.indent;
		}

		for (const line of this.parsonsWidget.modified_lines) {
			const el = document.getElementById(line.id);
			if (!el) continue;
			const inputs = Array.from(el.querySelectorAll('input.text-box'));
			if (inputs.length > 0) blanks[line.id] = inputs.map(inp => inp.value);
		}

		return { solutionIds, indents, blanks };
	};

	// Applies a previously saved arrangement to an already-initialised widget.
	// Must be called after parsonsWidget.init() + alphabetize() and before the
	// sortable <ul> references are captured (so listeners land on the right node).
	applySavedArrangement = (arrangement) => {
		if (!arrangement || !this.parsonsWidget) return;
		const { solutionIds, indents, blanks } = arrangement;

		const solutionSet = new Set(solutionIds);
		const allIds = this.parsonsWidget.modified_lines.map(l => l.id);
		const starterIds = allIds.filter(id => !solutionSet.has(id));

		this.parsonsWidget.createHTMLFromLists(solutionIds, starterIds);

		for (const [id, indent] of Object.entries(indents || {})) {
			const line = this.parsonsWidget.getLineById(id);
			if (line) {
				line.indent = indent;
				this.parsonsWidget.updateHTMLIndent(id);
			}
		}

		for (const [id, blockBlanks] of Object.entries(blanks || {})) {
			const el = document.getElementById(id);
			if (!el) continue;
			const inputs = el.querySelectorAll('input.text-box');
			blockBlanks.forEach((val, i) => {
				if (inputs[i]) inputs[i].value = val;
			});
		}

		this.applyBlankInputLimit();
	};

	applyBlankInputLimit = () => {
		const textInputs = this.querySelectorAll('input.text-box');
		for (const input of textInputs) {
			input.maxLength = 50;
			const li = input.closest('li[id]');
			if (li) {
				const blanksInLine = Array.from(li.querySelectorAll('input.text-box'));
				const idx = blanksInLine.indexOf(input);
				input.setAttribute('aria-label',
					blanksInLine.length > 1
						? `Code blank ${idx + 1} of ${blanksInLine.length}`
						: 'Code blank'
				);
			} else {
				input.setAttribute('aria-label', 'Code blank');
			}
		}
	};

	isToolBlock = (block) => {
		if (!block) return false;
		const id = block.id;
		const line = this.parsonsWidget?.getLineById?.(id);
		const code = line?.code || line?.orig || '';
		const text = block.textContent || '';
		const html = block.innerHTML || '';

		if (code.includes('DEBUG') || text.includes('DEBUG') || html.includes('DEBUG')) {
			return true;
		}
		if (
			code.startsWith('# <input') ||
			code.startsWith('# !BLANK') ||
			code.trim() === '#' ||
			(text.trim().startsWith('#') && block.querySelector('input')) ||
			html.includes('# <input')
		) {
			return true;
		}
		return false;
	};

	shuffleStarterList = (starterList) => {
		if (!starterList) return;

		const blocks = Array.from(starterList.children);
		const regularBlocks = blocks.filter((block) => !this.isToolBlock(block));
		const toolBlocks = blocks.filter((block) => this.isToolBlock(block));

		for (let index = regularBlocks.length - 1; index > 0; index -= 1) {
			const randomIndex = Math.floor(Math.random() * (index + 1));
			[regularBlocks[index], regularBlocks[randomIndex]] = [regularBlocks[randomIndex], regularBlocks[index]];
		}

		for (const block of [...regularBlocks, ...toolBlocks]) {
			starterList.appendChild(block);
		}
	};

	syncColumnHeight = () => {
		const leftCol = this.leftColumnRef.value;
		const rightCol = this.rightColumnRef.value;
		if (!leftCol || !rightCol) {
			return;
		}

		// Only sync column height on large screens where they are side-by-side.
		// Problem statement height remains completely independent and stable.
		if (window.innerWidth >= 992) {
			rightCol.style.height = `${leftCol.offsetHeight}px`;
		} else {
			rightCol.style.height = 'auto';
		}
	};

	firstUpdated() {
		this.syncColumnHeight();
		window.addEventListener('resize', this.syncColumnHeight);

		if (window.ResizeObserver && this.leftColumnRef.value) {
			this.taskCardResizeObserver = new ResizeObserver(() => {
				this.syncColumnHeight();
			});
			this.taskCardResizeObserver.observe(this.leftColumnRef.value);
		}

		const guidanceDetails = this.rightColumnRef.value?.querySelector('.guidance-details');
		if (guidanceDetails) {
			guidanceDetails.addEventListener('toggle', this.syncColumnHeight);
		}

		const getListName = (listEl) => {
			if (!listEl) {
				return 'unknown';
			}
			const parent = listEl.parentElement;
			if (!parent) {
				return 'unknown';
			}
			if (parent === this.solutionRef.value) {
				return 'solution';
			}
			if (parent === this.starterRef.value) {
				return 'starter';
			}
			return 'unknown';
		};

		const getCurrentLocation = (itemId) => {
			const itemEl = document.getElementById(itemId);
			if (!itemEl || !itemEl.parentElement) {
				return {list: 'unknown', index: -1};
			}
			const listEl = itemEl.parentElement;
			const index = Array.from(listEl.children).indexOf(itemEl);
			return {
				list: getListName(listEl),
				index,
			};
		};

		let pendingMove = null;

		// Initialize the Parsons widget with references to the two columns
		this.parsonsWidget = new ParsonsWidget({
			sortableId: this.solutionRef.value,
			trashId: this.starterRef.value,
			containment: this.taskCardRef.value.querySelector('.card-body'),
			can_indent: !!this.requireIndentation,
			onSortableUpdate: () => {
				if (!pendingMove) {
					return;
				}
				const to = getCurrentLocation(pendingMove.id);
				const toIndent =
					this.parsonsWidget.getLineById(pendingMove.id)?.indent ?? 0;

				if (
					pendingMove.from.list === to.list &&
					pendingMove.from.index === to.index &&
					pendingMove.fromIndent === toIndent
				) {
					pendingMove = null;
					return;
				}

				// Record move locally for later submission with attempt
				this.recordBlockMove({
					block_id: pendingMove.id,
					from_container: pendingMove.from.list,
					to_container: to.list,
					from_index: pendingMove.from.index,
					to_index: to.index,
					from_indent: pendingMove.fromIndent,
					to_indent: toIndent,
					event_time: new Date().toISOString(),
				});
				document.dispatchEvent(new CustomEvent('student-activity'));

				pendingMove = null;
			},
		});
		// Load the initial code blocks into the widget
		this.parsonsWidget.init(this.codeLines);
		// Sort blocks alphabetically for consistent starting state
		this.parsonsWidget.alphabetize();
		this.applyBlankInputLimit();
		if (this.shuffleStarterBlocks && !this.savedArrangement) {
			this.shuffleStarterList(this.starterRef.value?.querySelector('ul'));
		}
		// Restore a previously saved arrangement (if any) — must happen after
		// alphabetize() and before sortableList is queried, so that listeners
		// attach to the correct <ul> elements.
		if (this.savedArrangement) {
			this.applySavedArrangement(this.savedArrangement);
		}

		const sortableList = this.solutionRef.value?.querySelector('ul');
		const starterList = this.starterRef.value?.querySelector('ul');

		const attachMoveStartTracking = (listEl) => {
			if (!listEl) {
				return;
			}
			$(listEl).on('sortstart', (event, ui) => {
				const itemId = ui?.item?.[0]?.id;
				if (!itemId) {
					pendingMove = null;
					return;
				}
				pendingMove = {
					id: itemId,
					from: getCurrentLocation(itemId),
					fromIndent: this.parsonsWidget.getLineById(itemId)?.indent ?? 0,
				};
			});
		};

		attachMoveStartTracking(sortableList);
		attachMoveStartTracking(starterList);

		// Track text typed into !BLANK input fields via event delegation on both containers
		const debounceTimers = new Map();

		const recordEdit = (input) => {
			const li = input.closest('li[id]');
			if (!li) return;
			const blockId = li.id;
			const inputs = Array.from(li.querySelectorAll('input.text-box'));
			const blankIndex = inputs.indexOf(input);
			const value = input.value;

			// Skip if value unchanged from last recorded edit for this block+blank
			const last = this.recordedEdits.findLast?.(e => e.block_id === blockId && e.blank_index === blankIndex);
			if (last && last.value === value) return;

			this.recordedEdits.push({
				block_id: blockId,
				blank_index: blankIndex,
				value,
				event_time: new Date().toISOString(),
			});
			document.dispatchEvent(new CustomEvent('student-activity'));
			this.dispatchEvent(new CustomEvent('arrangement-changed', {
				detail: { arrangement: this.getCurrentArrangement() },
				bubbles: true,
			}));
		};

		const attachEditTracking = (containerEl) => {
			if (!containerEl) return;

			containerEl.addEventListener('input', (event) => {
				if (!event.target.matches('input.text-box')) return;
				const input = event.target;
				const key = input.closest('li[id]')?.id + ':' + Array.from(input.closest('li[id]')?.querySelectorAll('input.text-box') ?? []).indexOf(input);
				clearTimeout(debounceTimers.get(key));
				debounceTimers.set(key, setTimeout(() => recordEdit(input), 500));
			});

			containerEl.addEventListener('blur', (event) => {
				if (!event.target.matches('input.text-box')) return;
				const input = event.target;
				const li = input.closest('li[id]');
				if (!li) return;
				const key = li.id + ':' + Array.from(li.querySelectorAll('input.text-box')).indexOf(input);
				clearTimeout(debounceTimers.get(key));
				recordEdit(input);
			}, true);
		};

		attachEditTracking(this.solutionRef.value);
		attachEditTracking(this.starterRef.value);
	}

		updated(changedProperties) {
			super.updated(changedProperties);
			if (
				changedProperties.has('resultsStatus') ||
				changedProperties.has('resultsHeader') ||
				changedProperties.has('resultsDetails')
			) {
				requestAnimationFrame(() => this.syncColumnHeight());
			}
		}

	disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener('resize', this.syncColumnHeight);
		if (this.taskCardResizeObserver) {
			this.taskCardResizeObserver.disconnect();
			this.taskCardResizeObserver = null;
		}
	}

	onRun() {
		// Update UI to show loading state and emit a 'run' event
		this.runStatus = 'Running code...';
		this.dispatchEvent(
			new CustomEvent('run', {
				detail: {
					// Full solution code assembled from sorted blocks
					code: this.parsonsWidget.solutionCode(),
					// Serializable block representation for persistence
					repr: this.parsonsWidget.reprCode(),
					// Include recorded moves to send with attempt
					moves: this.recordedMoves,
					// Include recorded blank edits to send with attempt
					edits: this.recordedEdits,
					// The IDs of blocks currently in the solution area in order
					studentOrder: Array.from(this.solutionRef.value.querySelectorAll('li')).map(li => {
						const lineObj = this.parsonsWidget.getLineById(li.id);
						return lineObj ? `block_${lineObj.orig + 1}` : li.id;
					}),
				},
			})
		);
		this.recordedMoves = [];
		this.recordedEdits = [];
	}

	onNextTask() {
		if (!this.nextTaskUrl) {
			return;
		}
		window.location.href = this.nextTaskUrl;
	}
}

// Register the custom element for use in HTML
customElements.define('problem-element', ProblemElement);
