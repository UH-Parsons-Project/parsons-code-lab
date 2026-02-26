export class FiniteWorker {
	constructor(code) {
		this.gotCalledBack = false;

		this.worker = new Worker('/dist/worker.js');
		this.worker.onmessage = this.handleMessage.bind(this);

		return new Promise((resolve) => {
			window.setTimeout(this.finishIt.bind(this), 1000 * 60);
			this.worker.postMessage(code);
			this.resolve = resolve;
		});
	}

	finishIt() {
		if (!this.gotCalledBack) {
			this.worker.terminate();
			this.resolve({error: {message: 'Infinite loop'}});
		}
	}

	handleMessage(event) {
		this.gotCalledBack = true;
		this.resolve(event.data);
	}
}
