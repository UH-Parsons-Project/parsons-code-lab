import {LitElement, html} from 'lit';

export class TestResultsElement extends LitElement {
	static properties = {
		status: {type: String},
		header: {type: String},
		details: {type: String},
		source: {type: String},
		teacherhint: {type: String},
	};

	createRenderRoot() {
		return this;
	}

	parseDetails(details) {
		const blocks = details.split(/(?=✅ Passed|❌ Failed|Summary:)/);
		return blocks.map(block => block.trim()).filter(Boolean).map(block => {
			if (block.startsWith('Summary:')) {
				return { type: 'summary', text: block };
			}
			if (block.startsWith('✅') || block.startsWith('❌')) {
				const isPass = block.startsWith('✅');
				
				let input = '', expected = '', got = '', output = '';
				
				const inputMatch = block.match(/Test input:\n\s*([\s\S]*?)(?=\nExpected:|\nGot:|\nOutput:|$)/);
				if (inputMatch) input = inputMatch[1].trim();
				
				const expectedMatch = block.match(/Expected:\n\s*([\s\S]*?)(?=\nGot:|\nOutput:|$)/);
				if (expectedMatch) expected = expectedMatch[1].trim();
				
				const gotMatch = block.match(/Got:\n\s*([\s\S]*?)(?=\nOutput:|$)/);
				if (gotMatch) got = gotMatch[1].trim();
				
				const outputMatch = block.match(/Output:\n\s*([\s\S]*?)$/);
				if (outputMatch) output = outputMatch[1].trim();
				
				if (!input && !expected && !got && !output) {
					return { type: 'test', status: isPass ? 'pass' : 'fail', raw: block };
				}
				
				return {
					type: 'test',
					status: isPass ? 'pass' : 'fail',
					input,
					expected,
					got,
					output,
					raw: block
				};
			}
			
			return { type: 'error', raw: block };
		});
	}

	renderDetails() {
		const details = this.details || '';
		if (!details) return '';

		const parsedBlocks = this.parseDetails(details);

		return parsedBlocks.map((block) => {
			if (block.type === 'summary') {
				// The summary is already displayed in the header badge, so we skip it here
				return html``;
			}
			if (block.type === 'test') {
				const icon = block.status === 'pass' ? '✅' : '❌';
				const statusClass = block.status === 'pass' ? 'test-card-pass' : 'test-card-fail';
				const title = block.status === 'pass' ? 'Test Passed' : 'Test Failed';
				
				if (!block.input && !block.expected && !block.got && !block.output) {
					return html`<div class="test-card ${statusClass}">
						<div class="test-card-header">
							<span class="test-icon">${icon}</span>
							<span class="test-title">${title}</span>
						</div>
						<div class="test-card-body">
							<pre class="test-code-block">${block.raw}</pre>
						</div>
					</div>`;
				}
				
				return html`
					<div class="test-card ${statusClass}">
						<div class="test-card-header">
							<span class="test-icon">${icon}</span>
							<span class="test-title">${title}</span>
						</div>
						<div class="test-card-body">
							${block.input ? html`
								<div class="test-section">
									<div class="test-section-title">Test Input</div>
									<pre class="test-code-block">${block.input}</pre>
								</div>
							` : ''}
							${block.expected ? html`
								<div class="test-section">
									<div class="test-section-title">Expected</div>
									<pre class="test-code-block">${block.expected}</pre>
								</div>
							` : ''}
							${block.got ? html`
								<div class="test-section">
									<div class="test-section-title">Got</div>
									<pre class="test-code-block">${block.got}</pre>
								</div>
							` : ''}
							${block.output ? html`
								<div class="test-section">
									<div class="test-section-title">Output</div>
									<pre class="test-code-block">${block.output}</pre>
								</div>
							` : ''}
						</div>
					</div>
				`;
			}
			
			return html`<div class="test-error-block">${block.raw}</div>`;
		});
	}

	render() {
		const teacherHint = (this.teacherhint || '').trim();

		return html`<div class="test-results-panel">
					<div class="test-results-details">
						${teacherHint
							? html`<div class="teacher-hint-box">
									<strong>Teacher hint:</strong> ${teacherHint}
								</div>`
							: ''}
						${this.renderDetails()}
					</div>
				</div>`;
	}
}

customElements.define('test-results-element', TestResultsElement);
