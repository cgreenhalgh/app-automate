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
- add initial sensor support (sensingkit light)
- add initial ui
- add initial actuator support (tplink plug)
- add initial trigger support

## limitations

- Like the quickstart sample, it only supports one live UI view
  at a time (single websocket connection).


## Running on databox in dev mode

from the quickstart...

Databox supports starting a development version of your container with the source code mounted from you hosts filesystem. This is particularly usefully for complex apps that use multiple drivers, as they are hard to test externally. To do this we use the --devmount option of the databox command. The databoxDevSrcMnt variable at the top of the package.json holds the configuration json string for this.

>> **You will need to correct the path in databoxDevSrcMnt in package.json before this will work (set it to pwd).**

```
npm run build-dev           # Builds a dev image using the Dockerfile-dev (adds nodemon and npm_modules outside of the src path)
npm run start-databox-dev   # Starts a local copy of databox with --devmount set to point to the code here also setts the password to databoxDev

# wait for databox to start go to http://127.0.0.1 install the https certificate and then go to https://127.0.0.1
```

Finally, you'll need to upload your manifest file to tell databox about the new app.

```
npm run upload-manifest     # Adds the databox manifest for this app to databox
```

After this go to https://127.0.0.1 login and navigate to the app store where you should be able to see the app ready to install. If the driver is not installed you will be asked to install it first if its manifest has been uploaded.

Once installed you can edit the code on your host and changes should be visible to the running databox app and nodemon will restart as required.

Databox maintains state between restarts so uploading the manifest and reinstalling is not always necessary between restarts.
If you make changes to the manifest this must be reuploaded and the app reinstalled.


## Running on databox in production mode

from the quickstart...

To get running on the databox, you will first need to create a docker container to run your code.  To do this, in the src directory type:

```
npm run build-prod       # Builds a production image using the Dockerfile
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

