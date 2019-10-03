# Databox simple Automate app

A simple app designed to allow simple automation tasks, i.e. set
simple triggers when data source values change to send values to
other actuators. (A bit like if this then that, or a cut-down
databox SDK.)

Written in node, based on the 
[databox-quickstart node app](https://github.com/me-box/databox-quickstart/tree/master/node/app)

Chris Greenhalgh, THe University of Nottingham, 2019.

Status: just created from quickstart

Todo: 
- finance example (e.g. truelayer transaction -> message)
- create own datasources and associated queues (needs store)
- persist 'current' index across restarts
- cron-style timers
- ? persist timer states across restarts ?
- other support for rate limiting (alt timers? alt queue disciplines?)
- support KV and TS (rather than TSBlob) datasources
- persist configuration
- better user metaphors
- pretty UI

## Paradigm

### Overview

Behaviour is specified by a set of `Rules`.
When a Rule fires it sends new value(s) to one or more
actuators, i.e. output capable data sources.

Each Rule has a set of preconditions which determine if/when
it can fire. These are based on the state(s) of a set of 
`Queues` and `Timers`. 

A Queue is build on top of a data source, and typically contains
the last few values of the data source (`value`) and their associated
timestamp (`time`).
It also has a `capacity` (i.e. how many values it can hold) and 
it can be initialised with old values from the data source
(`noldvalues` of them).

The state of queue is reflected in the its variables:
- `empty`, the index of the bottom of the queue (there is no value here)
- `current`, the current position of the queue, typically the last value
that was handled
- `max`, the top of the queue, i.e. the most recent value

So the Rule preconditions can e.g. require that there is a new value
in a queue (`q.max > q.current`), or that there is any value in a 
queue (`q.max > q.empty`). 

After a Rule has fired it performs a set of updates on the queues.
For example, it may mark one item as handled (`q.current++`) or 
all items as handled (`q.current = q.max`).

A Timer is a queue to which the value `true` is added every
`intervalms` milliseconds. It initially contains `initialvalue`
trues. Timers can be used as (sharable) rate limts.

Note, in addition each rule can be `enabled` or disabled, and
has a `priority` with respect to other rules that determines
the order in which rules are checked.
A rule call also be `manual`, meaning that the user must 
explicitly activate ("fire") it while it's preconditions are met
("armed").

### Operation

Initially any old values from datasources (`noldvalues`) are loaded
the corresponding queues, and all timers are initialised
(`initialvalue`).

All enabled Rules are tested in priority order. 
If a Rule's preconditions are satisified then the Rule is fired,
performing its activity (output), and then updating the queues.
The next priority Rule is then tested, and so on.

Each time a new datasource value is observed the corresponding 
queue(s) are updated and the Rules are re-evaluated. 
Similarly, when a Timer fires its Queue is updated and the Rules
are re-evaluated.

## Configuration

Currently it is configured by reading the file 
[src/config.json](src/config.json) as built into the app.

This is a JSON object with three properties:
- `timers`, an array of `Timer` records (see below)
- `queues`, an array of `Queue`/datasource records (see below)
- `rules`, an array of `Rule` records (see below).

A `Timer` record is an object with fields:
- `name` (string), used to refer the timer in the UI and in Rules
- `capacity` (integer), maximum by which `max` can exceed `empty`
- `initialvalue` (integer), number of values initially (i.e. `max` on start-up)
- `intervalms` (number), number of milliseconds between adding new values to the Timer queue.

For example,
```
        {
                "name": "1Hz",
                "capacity": 1,
                "initialvalue": 1,
                "intervalms": 1000
        }
```
is a Timer called "1Hz", with capacity one that is refilled (if empty) 
once per second (every 1000ms).

A `Queue` records is an object with fields:
- `name` (string), used to refer to Queue in theUI and in Rules
- `clientid` (string), the clientid from the app manifest identifying
the datasource to be associated with this Queue
- `capacity` (integer), the maximum number of values to be held in the Queue
- `noldvalues` (integer), the number of old values to be loaded into the
queue on startup (with `current` pointing to the last of them at present)
- `actuator` (boolean), whether the datasource should be made available
to Rules as an actuator (possible output destination)

For example, 
```
        {
                "name": "DS:LIGHT",
                "clientid": "LIGHT",
                "capacity": 10,
                "noldvalues": 3
        },
```
is a Queue for the datasource with client ID "LIGHT" 
(see [databox-manifest.json](databox-manifest.json),
to be named locally as "DS:LIGHT", with space to 10 values, initialiased
with 3 old values (if available).

A `Rule` record is an object with fields:
- `name` (string), used to refer to the Rule in the UI
- `enabled` (boolean, default true), whether rule can be activated
- `manual` (boolean, default false), whether user trigger is also required
- `priority` (number, default 0), priority of execution
- `qs`, a map of local Queue names to formal Queue names. Note, local queue 
names should normally be valid Javascript property names for use in 
preconditions, etc.
- `preconditions`, an array of Javascript expressions using the local
queue names specified in `qs` that will all be true if the Rule should be
fired
- `actions`, an array of objects with field `actuator` specifying 
the clientid of the corresponding datasource (see above) and `value`
specifying a Javascript expression to be evaluated to determine the
value to set.
- `updates`, an array of Javascript operations using the local queue
names to be executed after the Rule fires.

For example,
```
        {
                "name": "light on when not dark",
                "manual": false,
                "qs": {
                        "timer": "1Hz",
                        "light": "DS:LIGHT",
                        "plug": "DS:TPLINK_PLUG_SET"
                },
                "preconditions": [
                        "timer.max > timer.current",
                        "light.max > light.empty",
                        "light.get(light.max).value[1] > 0",
                        "plug.max == plug.empty || plug.get(plug.max).value.data == 'off'"
                ],
                "actions": [
                {
                        "actuator": "TPLINK_PLUG_SET",
                        "value": "{data:'on'}"
                }
                ],
                "updates": [
                        "timer.current ++"
                ]
        },
```
Is a rule which uses the Timer called "1Hz" under the local name "timer",
the datasource Queue called "DS:LIGHT" under the local name "light" and
the datasource Queue called "DS:TPLINK_PLUG_SET" under the local name
"plug".

It fires if the timer has an "unused" value AND
there is some data available for the light AND
the most recent value from the light is >0 AND
there is no data availble from the plug, or the
most recent value from the plug is "off".

When if fires is send the value `{data:'on'}` to the plug actuator.
It also adds one to `timer.current`, effectively consuming the (only)
available value from the timer. (This prevents this rule - and any others
using the same Timer - from firing more than once per second.)`

E.g.
```
{
	"name": "on",
	"manual": true,
	"actions": [
	{
		"actuator": "TPLINK_PLUG_SET",
		"value": "{data:'on'}"
	}
	]
}
```
is an always available manual rule to set the TPLINK_PLUG_SET to on.

## limitations

- Like the quickstart sample, it only supports one live UI view
  at a time (single websocket connection).


## Running on databox in production mode

from the quickstart...

To get running on the databox, you will first need to create a docker container to run your code.  To do this, in the src directory type:

```
npm run build       # Builds a production image using the Dockerfile
npm run start-databox   # Starts a local copy of databox and sets the password to databoxDev

# wait for databox to start go to http://127.0.0.1 install the https certificate and then go to https://127.0.0.1

```

Finally, you'll need to upload your manifest file to tell databox about the new driver.

```
npm run upload-manifest     # Adds the databox manifest for this driver to databox
```

In this mode if you make changes to the code you must run `npm run build-prod` and restart the driver using the restart icon in the top left of the ui.
If you make changes to the manifest this must be reuploaded and the driver reinstalled.

## Stopping and resetting databox

from the quickstart...

To stop databox run:

```
npm run stop-databox
```

To completely reset databox run:

```
npm run wipe-databox
```

