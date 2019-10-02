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
//   timers: {
//     Hz1: { 
//       intervalms: 1000,
//       initialvalue: 1
//   },
//
// {
//   qs: {
//     timer: '1Hz',
//     light: 'DS:LIGHT',
//     plug: 'DS:DS:TPLINK_PLUG_SET'
//   },
//   preconditions: [
//    'timer.max > timer.current',
//    'light.max > light.empty',
//    'light.get(light.max).value[1] > 0',
//    '(plug.max == plug.empty || plug.get(plug.max).value.data == \'on\''
//   ],
//   actions: [
//     {
//       actuator: 'TPLINK_PLUG_SET',
//       value: '{data:\'off\'}'
//     }
//   ],
//   updates: [
//     'timer.current ++'
//   ]
// }
const queue = require('./queue');

function makeQueueMap(queues) {
	let qs = {};
	for (let q of queues) {
		qs[q.name] = q;
	}
	return qs;
}

class Rule1 {
	constructor(name) {
		this.name = name;
		this.enabled = true;
		this.priority = 0;
		this.qnames = {};
		this.qnames.timer = '1Hz';
		this.qnames.light = 'DS:LIGHT';
		this.qnames.plug = 'DS:TPLINK_PLUG_SET';
	}
	makeQs(queueMap) {
		let qs = {};
		for (let n in this.qnames) {
			let qn = this.qnames[n];
			qs[n] = queueMap[qn];
			if (!qs[n]) {
				throw `Could not find queue ${qn} to use as ${n} in ${this.name}`;
			}
		}
		return qs;
	}
	testPreconditions(qmap) {
		// TODO script
		let qs = this.makeQs(qmap);
		return qs.timer.max > qs.timer.current &&
                        qs.light.max > qs.light.empty &&
                        qs.light.get(qs.light.max).value[1] > 0 &&
                        (qs.plug.max == qs.plug.empty ||
                                qs.plug.get(qs.plug.max).value.data == 'on');

		/*
		return qs['1Hz'].max > qs['1Hz'].current && 
			qs['DS:LIGHT'].max > qs['DS:LIGHT'].empty &&
			qs['DS:LIGHT'].get(qs['DS:LIGHT'].max).value[1] > 0 &&
			(qs['DS:TPLINK_PLUG_SET'].max == qs['DS:TPLINK_PLUG_SET'].empty ||
				qs['DS:TPLINK_PLUG_SET'].get(qs['DS:TPLINK_PLUG_SET'].max).value.data == 'on');
		*/
	}
	action(actuators) {
		console.log('Rule1 Action!');
		let ds = actuators.find((ds) => ds.clientid == 'TPLINK_PLUG_SET');
		if (ds) {
			ds.actuate({data:'off'})
		} else {
			console.log(`${this.name} cannot find actuator TPLINK_PLUG_SET`);
		}
	}
	update( qmap ) {
		let qs = this.makeQs(qmap);
		qs.timer.current ++;
		qs.timer.callChanged();
	}
}

let rules = [];
rules.push(new Rule1('Rule1'));

module.exports.CheckRules = function (queues, actuators) {
	let qs = makeQueueMap(queues);

	// could fire?
	let ready = [];
	for (let r of rules) {
		if (r.enabled) {
			try {
				if (r.testPreconditions( qs )) {
					ready.push (r);
				}
			} catch (err) {
				console.log(`Error testing preconditions on rule ${r.name} - disabling rule`, err);
				r.enabled = false;
			}
		}
	}
	ready.sort((a,b) => a.priority - b.priority);
	if (ready.length==0) {
		console.log(`no rule ready`)
		return;
	}
	let r = ready[0];
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
}

