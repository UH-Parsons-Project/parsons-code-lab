/* global ParsonsWidget */

// Lit web component base + templating and styling utilities
import {LitElement, html, css} from 'lit';
// Allows rendering HTML strings safely for trusted content
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
// Ref helpers to access rendered DOM nodes
import {ref, createRef} from 'lit/directives/ref.js';

import './loader-element.js';
import './test-results-element.js';

// ProblemElement: UI wrapper for a single Parsons problem.
// Responsibilities:
// - Present problem description
// - Render two sortable code areas (starter & solution)
// - Handle Run action and emit a 'run' event with code payload
export class ProblemElement extends LitElement {
	static properties = {
		name: {type: String},
		description: {type: String},
		codeLines: {type: String},
		codeHeader: {type: String},
		isLoading: {type: Boolean},
		enableRun: {type: Boolean, default: false},
		runStatus: {type: String},
		resultsStatus: {type: String},
		resultsHeader: {type: String},
		resultsDetails: {type: String},
	};

	static styles = css`
		/* Layout proportions for the two Parsons columns */
		.starter {
			width: 40%;
		}
		.solution {
			width: 58%;
			margin-left: 2%;
		}
	`;

	// Refs to the container elements bound to the Parsons widget
	starterRef = createRef();
	solutionRef = createRef();

	// Opt-out of Shadow DOM to allow existing CSS frameworks to style content
	createRenderRoot() {
		return this;
	}

	render() {
		// Default results placeholder until tests are run
		let results =
			'Test results will appear here after clicking "Run Tests" above.';
		if (this.resultsStatus) {
			// Render the test results component with current status
			results = html`<test-results-element
				status=${this.resultsStatus}
				header=${this.resultsHeader}
				details=${this.resultsDetails}
			></test-results-element>`;
		}

		return html`
			<!-- Problem description card -->
			<div class="row mt-3">
				<div class="col-sm-12">
					<div class="card">
						<div class="card-header">
							<h3>Problem Statement</h3>
						</div>
						<div class="card-body">${unsafeHTML(this.description)}</div>
					</div>
				</div>
			</div>

			<!-- Parsons widget area: starter (trash) and solution columns -->
			<div class="row mt-4">
				<div class="col-sm-12">
					<div class="card">
						<div class="card-body">
							<div
								${ref(this.starterRef)}
								class="sortable-code starter"
							></div>
							<div
								${ref(this.solutionRef)}
								class="sortable-code solution"
							></div>
							<div style="clear:both"></div>
							<div class="row float-right">
								<div class="col-sm-12">
									<span style="margin-right: 8px">
										${this.runStatus &&
										html`<loader-element></loader-element>`}
										${this.runStatus}
									</span>
									<button
										@click=${this.onRun}
										type="button"
										class="btn btn-primary"
										?disabled=${!this.enableRun}
									>
										Run Tests
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Test results card -->
			<div class="row mt-4">
				<div class="col-sm-12">
					<div class="card">
						<div class="card-header">
							<h4>Test Cases</h4>
						</div>
						<div id="test_description">
							<div class="card-body">${results}</div>
						</div>
					</div>
				</div>
			</div>
		`;
	}

	firstUpdated() {
		// Initialize the Parsons widget with references to the two columns
		this.parsonsWidget = new ParsonsWidget({
			sortableId: this.solutionRef.value,
			trashId: this.starterRef.value,
		});
		// Load the initial code blocks into the widget
		this.parsonsWidget.init(this.codeLines);
		// Optional: sort blocks alphabetically for consistent starting state
		this.parsonsWidget.alphabetize();
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
				},
			})
		);
	}
}

// Register the custom element for use in HTML
customElements.define('problem-element', ProblemElement);
