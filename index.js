
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
    sharedClientSockets = require('./lib/shared-client-sockets.js');

// Variables
var rcFileNamePrefix = "rk8_auth_notifyd",
    defaults = {
        port: 8080,
        notifyPort: 8081,
        channels: {
          "./lib/notification-channels/rk8-socket-io.js": {}
        },
        authenticate: {
          "modules": {
            "./lib/authenticate/localhost-ropverify.js": {}
          }
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
        notifyApp = express(),
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

    var sharedSockets = sharedClientSockets(options);

    app.use( function(req, res, next) {
      console.log('Request for url:', req.url, req.originalUrl);
      next();
    });
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
        channelFn(server, sharedSockets);
      }
    });

    server.listen( options.port );

    notifyApp.listen( options.notifyPort );
    notifyApp.use('/notify', notify_router);
    notify_router.use(bodyParser.json());

    /*
     * NOTE: This API is strictly for use by trusted processes within a firewall.
     * DO NOT expose this API to an untrusted network.
     */
    notify_router.all('/:username/:msg?', function (req, res){
        var details = {
            username: req.params.username,
            msg: (req.query || {}).msg || req.headers['notification-message'] || (req.body || {}).msg
        };
        console.log("Recieved nofity request for username: "+req.params.username);
        console.log(" details: "+JSON.stringify(details));

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
