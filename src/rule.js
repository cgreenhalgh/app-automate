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
			manual: false,
			qs: {},
			preconditions: [],
			actions: [],
			updates: []
		}
		options = { ...defaults, ...options }
		this.name = options.name;
		this.enabled = options.enabled;
		this.priority = options.priority;
		this.manual = options.manual;
		this.armed = false;
		this.wasarmed = false;
		this.armedId = 0;
		this.fireId = 0;
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
		this.error = null;
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
	action(actuators, qmap) {
		let qs = this.makeQs(qmap);
		this.activated++;
		for (let i=0; i<this.actions.length; i++) {
			let action = this.actions[i];
			let ds = actuators.find((ds) => ds.clientid == action.actuator);
			let value = safeEval(action.value, `rule ${this.name} action ${i} value`, qs);
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
	if (!options.name)
		otions.name = 'Anonymous rule '+(rules.length+1);
	let r = getRule(options.name);
	if (r) {
		throw `Rule ${options.name} already exists`;
	}
	r = new Rule(options);
	rules.push(r);
}
function getRule(name) {
	return rules.find((r) => r.name == name)
}
module.exports.EnableRule = function(name) {
	let r = getRule(name)
	if (!r)
		return false;
	r.enabled = true;
	return true;
}
module.exports.DisableRule = function(name) {
	let r = getRule(name)
	if (!r)
		return false;
	r.enabled = false;
	return true;
}
module.exports.FireRule = function(name, fireid) {
	let r = getRule(name)
	if (!r)
		return false;
	r.fireId = Number(fireid);
	if (r.fireId != r.armedId) {
		console.log(`Fire rule ${name} with invalid fire id ${fireid} (should be ${r.armedId})`)
		return false;
	}
	return true;
}
module.exports.CheckRules = function (queues, actuators) {
	let qs = makeQueueMap(queues);
	let enabled = []
	for (let r of rules) {
		r.wasarmed = r.armed;
		r.armed = false;
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
			return r.wasarmed; // counts as a change
		}
	} catch (err) {
		console.log(`Error testing preconditions on rule ${r.name} - disabling rule`, err);
		r.enabled = false;
		r.error = `in preconditions, ${err}`;
		return false
	}
	if (r.manual) {
		let justarmed = false;
		r.armed = true;
		if (!r.wasarmed) {
			console.log(`arm rule ${r.name}`);
			r.armedId++;
			justarmed = true;
		}
		if (r.fireId != r.armedId) {
			return justarmed; // counts as a change!
		}
		// avoid refiring from the same input
		r.armedId++;
	}
	console.log(`fire rule ${r.name}`);
	try {
		r.action(actuators, qs);
	} catch (err) {

		console.log(`Error doing action on rule ${r.name} - disabling rule`, err);
		r.error = `in actions, ${err}`;
		r.enabled = false;
	}
	try {
		r.update(qs);
	} catch (err) {
		console.log(`Error doing update on rule ${r.name} - disabling rule`, err);
		r.error = `in updates, ${err}`;
		r.enabled = false;
	}
	return true;
}

