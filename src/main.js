var https = require("https");
var http = require("http");
var express = require("express");
var bodyParser = require("body-parser");
var databox = require("node-databox");
var WebSocket = require("ws");

const DATABOX_ARBITER_ENDPOINT = process.env.DATABOX_ARBITER_ENDPOINT || 'tcp://127.0.0.1:4444';
const DATABOX_ZMQ_ENDPOINT = process.env.DATABOX_ZMQ_ENDPOINT || "tcp://127.0.0.1:5555";
const DATABOX_TESTING = !(process.env.DATABOX_VERSION);
const PORT = DATABOX_TESTING ? 8090 : process.env.PORT || '8080';

//server and websocket connection;
let ws, server = null;

class DataSource {
  constructor(
      clientid,
      hypercat
  ) {
    this.clientid = clientid
    this.hypercat = hypercat
    this.metadata = databox.HypercatToDataSourceMetadata( hypercat )
    let storeEndpoint = databox.GetStoreURLFromHypercat( hypercat )
    console.log(`DataSource ${clientid} is ${this.metadata.DataSourceID}, actuator ${this.metadata.IsActuator}`)
    
    this.store = databox.NewStoreClient( storeEndpoint, DATABOX_ARBITER_ENDPOINT, false)
    // Note, presumes blob - TODO check
    this.store.TSBlob.Observe( this.metadata.DataSourceID, 0 )
    .then((emitter) => {
      console.log(`started listening to ${this.metadata.DataSourceID}`);

      emitter.on('data', (data) => {
          console.log(`seen data from ${this.metadata.DataSourceID}`, data);
          // workaround datasourceid not set (why??)
          let msg = { 
              datasourceid: this.metadata.DataSourceID, 
              data: data.data, 
              timestamp: data.timestamp
          }
          if (ws) {
              let msg = { 
                id: "DS:"+this.metadata.DataSourceID,
                parentid: "dstable",
                element: "tr",
                html: "<td>"+this.metadata.DataSourceID+"</td><td>"+JSON.stringify(data.data)+"</td><td>"+data.timestamp+"</td>"
              }
              let json = JSON.stringify(msg)
              try {
                ws.send(json);
              } catch (err) {
                console.log(`error sending ws message`, err)
              }
          }
          // TODO custom behaviour...
          if (clientid == 'LIGHT') {
            let value = Number( data.data[1] )
            actuate( 'TPLINK_PLUG_SET', { data: (value < 2 ? 'off' : 'on') } )
          }
      });

      emitter.on('error', (err) => {
          console.warn(`error from ${this.metadata.DataSourceID}`, err);
      });
      
    }).catch((err) => {
      console.warn(`Error Observing ${this.metadata.DataSourceID}`, err);
    });
  }
  async actuate( data ) {
    if ( ! this.metadata.IsActuator ) {
      throw `data source ${this.metadata.DataSourceID} is not an actuator`
    }
    console.log(`actuate ${this.metadata.DataSourceID}`, data)
    await this.store.TSBlob.Write( this.metadata.DataSourceID, data )
    .then(() => {
      console.log(`successfully actuated ${this.metadata.DataSourceID}`);
    }).catch((err) => {
      console.log(`failed to actuate ${this.metadata.DataSourceID}`, err)
      throw `failed to actuate ${this.metadata.DataSourceID}: ${err.message}`
    });
  }
}

const DATA_SOURCES = ['TPLINK_PLUG_SET', 'LIGHT']
let dataSources = []

if (DATABOX_TESTING) {
    // TODO ? 
} else {
  for (let clientid of DATA_SOURCES) {
    let hypercat = process.env['DATASOURCE_'+clientid]
    if (hypercat) {
      console.log(`Try source ${clientid}: ${hypercat}`)
      try {
        let ds = new DataSource( clientid, hypercat )
        dataSources.push(ds)
      } catch (err) {
        console.log(`Error setting update datasource ${clientid}: ${err.message}`, err)
      }
    } else {
      console.log(`Optional source ${clientid} not specified`)
    }
  }
}


//set up webserver to serve driver endpoints
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.set('views', __dirname+'/views');
app.set('view engine', 'ejs');

app.get("/", function (req, res) {
    res.redirect("/ui");
});

app.get("/ui", function (req, res) {
    res.render('index', { testing: DATABOX_TESTING });
});

let actuate = async function( clientid, data ) {
  let plug = dataSources.find((ds) => ds.clientid == clientid )
  if (plug) {
    await plug.actuate( data )
    return
  }
  else {
    throw `could not find datasource with clientid ${clientid}`
  }
}

let handleUiActuate = async function(req, res) {
  console.log(`actuate request...`)
  // TODO specify actuator & data from client
  try {
    await actuate( 'TPLINK_PLUG_SET', { data: 'on' } )
    res.send({ success: true });
  } catch (err) {
    console.log(`actuate error`, err)
    res.send({ success: false });
  }
}
app.get('/ui/actuate', (req, res) => {
  handleUiActuate( req, res )
});

app.get("/status", function (req, res) {
    res.send("active");
});



//when testing, we run as http, (to prevent the need for self-signed certs etc);
if (DATABOX_TESTING) {
    console.log("[Creating TEST http server]", PORT);
    server = http.createServer(app).listen(PORT);

} else {
    console.log("[Creating https server]", PORT);
    const credentials = databox.GetHttpsCredentials();
    server = https.createServer(credentials, app).listen(PORT);
}

//finally, set up websockets
const wss = new WebSocket.Server({ server, path: "/ui/ws" });

wss.on("connection", (_ws) => {
    ws = _ws;
});

wss.on("error", (err) => {
    console.log("websocket error", err);
    if (ws) {
        ws = null;
    }
})
