// rule.js - a rule to run over some queues
// with
// - queues
// - preconditions (in terms of queues)
// - output action
// - queue updates
// - enabled
// - priority
//
// e.g.
//
// Timer: 
// {
//   name: "1Hz",
//   intervalms: 1000,
//   capacity: 1,
//   initialvalue: 1
// },
//
// Datasource:
// {
//   name: "DS:LIGHT",
//   clientid: "LIGHT",
//   capacity: 10,
//   noldvalues: 3,
//   actuator: false
// }
// 
// Rule
// {
//   name: "rule name",
//   qs: {
//     timer: "1Hz",
//     light: "DS:LIGHT",
//     plug: "DS:DS:TPLINK_PLUG_SET"
//   },
//   preconditions: [
//    "timer.max > timer.current",
//    "light.max > light.empty",
//    "light.get(light.max).value[1] > 0",
//    "(plug.max == plug.empty || plug.get(plug.max).value.data == 'on'"
//   ],
//   actions: [
//     {
//       actuator: "TPLINK_PLUG_SET",
//       value: "{data:'off'}"
//     }
//   ],
//   updates: [
//     "timer.current ++"
//   ]
// }
const queue = require('./queue');
const _eval = require('eval'); 

let debug = false;

function makeQueueMap(queues) {
	let qs = {};
	for (let q of queues) {
		qs[q.name] = q;
	}
	return qs;
}
function safeEval(ex, filename, context) {
	let res = _eval('module.exports = '+ex, filename, context, false);
	if (debug) { 
		console.log(`eval: ${ex} -> ${JSON.stringify(res)}`)
	}
	return res;
}
function findQnames(ex, qs) {
	var vpat = /([A-Za-z_][A-Za-z_0-9]*)/g;
	var match;
	let names = [];
	while((match=vpat.exec(ex))) {
		let name = match[1];
		if (qs[name]!==undefined) {
			names.push(name);
		} else if (debug) {
			console.log(`ignore unknown possible qname ${name}`);
		}
	}
	return names;
}

class Rule {
	constructor(options) {
		let defaults = { 
			name: 'unnamed',
			enabled: true,
			priority: 0,
			qs: {},
			preconditions: [],
			actions: [],
			updates: []
		}
		options = { ...defaults, ...options }
		this.name = options.name;
		this.enabled = options.enabled;
		this.priority = options.priority;
		this.qs = options.qs;
		this.preconditions = options.preconditions
		this.actions = options.actions;
		this.updates = options.updates;
		this.updateQnames = [];
		for (let i=0; i<this.updates.length; i++) {
			this.updateQnames = this.updateQnames.concat(findQnames(this.updates[i], this.qs));
		}
		if (debug) {
			console.log(`updateQnames: ${this.updateQnames}`);
		}
		this.activated = 0;
	}
	makeQs(queueMap) {
		let qs = {};
		for (let n in this.qs) {
			let qn = this.qs[n];
			qs[n] = queueMap[qn];
			if (!qs[n]) {
				throw `Could not find queue ${qn} to use as ${n} in ${this.name}`;
			}
		}
		return qs;
	}
	testPreconditions(qmap) {
		let qs = this.makeQs(qmap);
		for (let i=0; i<this.preconditions.length; i++) {
			if (!safeEval(this.preconditions[i], `rule ${this.name} precondition ${i}`, qs)) {
				return false;
			}
		}
		return true;
	}
	action(actuators) {
		this.activated++;
		for (let i=0; i<this.actions.length; i++) {
			let action = this.actions[i];
			let ds = actuators.find((ds) => ds.clientid == action.actuator);
			let value = safeEval(action.value, `rule ${this.name} action ${i} value`, {});
			if (ds) {
				ds.actuate(value)
			} else {
				console.log(`${this.name} cannot find actuator ${action.actuator}`);
			}
		}
	}
	update( qmap ) {
		let qs = this.makeQs(qmap);
		for (let i=0; i<this.updates.length; i++) {
			let update = this.updates[i];
			safeEval(update, `rule ${this.name} update ${i}`, qs)
			// changed queues
			for (let i=0; i<this.updateQnames.length; i++) {
				qs[this.updateQnames[i]].callChanged();
			}
		}
	}
}

let rules = [];

module.exports.GetRules = function() {
	return rules;
}

module.exports.AddRule = function(options) {
	let r = new Rule(options);
	rules.push(r);
}

module.exports.CheckRules = function (queues, actuators) {
	let qs = makeQueueMap(queues);
	let enabled = []
        for (let r of rules) {
                if (r.enabled) {
			enabled.push(r);
		}
	}
        enabled.sort((a,b) => a.priority - b.priority);
	let fired = 0;
	for (let r of enabled) {
		if (checkRule(r, qs, actuators))
			fired ++;
	}
	return fired;
}
function checkRule(r, qs, actuators) {
	// could fire?
	try {
		if (!r.testPreconditions( qs )) {
			return false
		}
	} catch (err) {
		console.log(`Error testing preconditions on rule ${r.name} - disabling rule`, err);
		r.enabled = false;
		return false
	}
	console.log(`fire rule ${r.name}`);
	try {
		r.action(actuators);
	} catch (err) {

		console.log(`Error doing action on rule ${r.name} - disabling rule`, err);
		r.enabled = false;
	}
	try {
		r.update(qs);
	} catch (err) {
		console.log(`Error doing update on rule ${r.name} - disabling rule`, err);
		r.enabled = false;
	}
	return true;
}

