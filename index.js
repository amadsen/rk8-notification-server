
/**
 * Rocket Auth Notification Service
 */
"use strict";
// Dependencies
var express = require('express'),
    bodyParser = require('body-parser'),
    http = require("http"),
    path = require("path"),
    rc = require("rc"),
    deepExtend = require("deep-extend"),
    sharedSockets = require('./lib/shared-client-sockets.js');

// Variables
var rcFileNamePrefix = "rk8_auth_notifyd",
    defaults = {
        port: 8080,
        channels: {
          "./lib/notification-channels/rk8-socket-io.js": {}
        }
    };

/**
 * Eventually socket.io will be a notification socket module (and/or plugin)
 * just like Google Cloud Messaging, Apple Push Notification, standard web socket,
 * and other notification channels (maybe even email and SMS, though
 * 'registration' doesn't have as clear a meaning in those contexts.)
 */
function startNotificationService(opts, ready) {
    var app = express(),
        server = http.Server(app),
        notify_router = express.Router({
            caseSensitive: true,
            mergeParams: true,
            strict: true
        });

    var rcOpts = rc(rcFileNamePrefix, {}),
        options = deepExtend({}, defaults);
    options = deepExtend(options, rcOpts);
    options = deepExtend(options, opts);

    console.log("Merged options: ");
    console.log(options);

    /*
    Initialize all configured notification-channels
    */
    Object.keys(options.channels).forEach( function configureChannel(module_path) {
      var channelCfg = options.channels[ module_path ],
          channelFn = ('function' === typeof(channelCfg))? channelCfg : (
            function(module_path, cfg){
              try {
                return require(module_path)(cfg);
              } catch (e) {
                console.warn("Unable to initialize channel: ", module_path, cfg);
              }
            }
          )(module_path, channelCfg);

      if('function' === typeof(channelFn)){
        channelFn(server, sharedSockets.register);
      }
    });

    server.listen( options.port );

    app.get('/', function (req, res) {
      res.sendfile( path.join(__dirname, 'browser', 'index.html') );
    });

    app.use('/notify', notify_router);
    notify_router.use(bodyParser.json());
    notify_router.all('/:id/:msg?', function (req, res){
        var details = {
            socket: req.params.id,
            msg: (req.query || {}).msg || req.headers['notification-message'] || (req.body || {}).msg
        };
        console.log("Recieved nofity request for id: "+req.params.id);
        console.log(" details: "+JSON.stringify(details));

        /*
         * TODO: Before making this available to anyone, put authentication / authorization code in place!!!
         */
        if (!details.msg) {
            return res.sendStatus(400)
        }
        return sharedSockets.send(details, function(err){
            if (err) {
                console.log(err);
                return res.sendStatus(400);
            }
            console.log("Notification sent!");
            res.status(200);
            return res.send("Notification Sent!");
        });
    });

}

if (require.main === module) {
    // if we started this module directly, use default opts
    startNotificationService();
}

module.exports = {
    start: startNotificationService
};
