// queue - abstraction over datasource inputs with additional
// semantics/options.
// 
// Every queue has:
// - capacity
// - empty point (index)
// - current point (index)
// - max point (index)
//
// some queues will have time(s) associated with each element
// (from timers or TS datasources). Others may not (from KV
// datasources).
//
// in future there may be configurable discard policies and
// other goodness.

const databox = require("node-databox");
const DATABOX_ARBITER_ENDPOINT = process.env.DATABOX_ARBITER_ENDPOINT || 'tcp://127.0.0.1:4444';

class QueueItem {
	constructor(value,time) {
		this.value = value;
		this.time = time;
	}
};

class Queue {
	constructor(name, capacity) {
		this.name = name;
		this.capacity = (capacity!==undefined) ? capacity : 1;
		this.buffer = [];
		this.empty = 0;
		this.current = 0;
		this.max = 0;
		this.changed = true;
		this.onchange = [];
	}
	add(value,time) {
		let item = new QueueItem(value,time);
		this.buffer.push(item);
		this.max ++;
		if (this.buffer.length > this.capacity) {
			this.buffer.splice(0,1);
			this.empty++;
			if (this.empty > this.current) {
				this.current = this.empty;
			}
		}
		this.changed = true;
		this.callChanged();
	}
	get(index) {
		if (index <= this.empty) {
			throw `queue.get(${index}) when empty=${this.empty}`;
		}
		if (index > this.max) {
			throw `queue.get(${index}) when max=${this.max}`;
		}
		return this.buffer[index-this.empty-1];
	}
	setChanged(changed) {
		this.changed = changed!==undefined ? changed : true;
	}
	// TODO observable?
	onChanged(callback) {
		this.onchange.push(callback);
	}
	callChanged() {
		for (let cb of this.onchange) {
			try {
				cb(this);
			} catch (err) {
				console.log(`Error in queue callback: ${err}`, err);
			}
		}
	}
}

// a queue which is filled (with trues) by a timer
module.exports.NewTimerQueue = function(name, capacity, initialvalue, intervalms) {
	let q = new Queue(name, capacity);
	let fill = function() {
		q.add(true, new Date().getTime());
	};
        for (let i=0; i<initialvalue; i++) {
                fill()
	}
	setInterval(fill, intervalms);
	return q;
}

// a queue which is filled from a TSBlob
module.exports.NewTSBlobQueue = function(name, capacity, hypercat, noldvalues) {
	let q = new Queue(name, capacity);

	let metadata = databox.HypercatToDataSourceMetadata( hypercat )
	let storeEndpoint = databox.GetStoreURLFromHypercat( hypercat )
	console.log(`queue ${name} is DS ${metadata.DataSourceID}`)
	let store = databox.NewStoreClient( storeEndpoint, DATABOX_ARBITER_ENDPOINT, false)
	store.TSBlob.Observe( metadata.DataSourceID, 0 )
	.then((emitter) => {
		console.log(`queue ${name} listening to DS ${metadata.DataSourceID}`);
		emitter.on('data', (data) => {
			console.log(`queue ${name} seen data from DS ${metadata.DataSourceID}`, data);
			q.add(data.data, data.timestamp);
		})
		emitter.on('error', (err) => {
			console.warn(`queue error from ${metadata.DataSourceID}`, err);
		});
	}).catch((err) => {
		console.warn(`Error queue Observing ${metadata.DataSourceID}`, err);
	});
	if (noldvalues>0) {
		store.TSBlob.LastN( metadata.DataSourceID, noldvalues )
		.then((values) => {
			console.log(`queue ${name} got ${values.length}/${noldvalues} old values`);
			for (let i=0; i<values.length; i++) {
				q.add(values[i].data, values[i].timestamp);
			}
		})
		.catch((err) => {
			console.log(`Error queue ${name} getting ${noldvalues} from ${metadata.DataSourceID}: ${err}`, err);
		})
	}
	return q;
}


