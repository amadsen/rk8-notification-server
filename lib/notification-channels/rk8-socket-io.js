"use strict";

var socket_io = require("socket.io");

function requestIdentification (context) {
  // Client flow, step 2. Notification Service requests identification
  context.client.emit('identify', {}, requestAuthenticationCredentials.bind(null, context));
}

function requestAuthenticationCredentials (context, clientInfo) {
  var identity = clientInfo.id;
  // Client flow, step 7. Notification Service sends the
  // client-specific public key to Client
  context.getPublicKeyForClient(identity, function(err, clientPubKeyOpts){
    if (err) {
      return context.error(err, "Internal Error");
    }

    context.client.emit(
      'authenticate',
      clientPubKeyOpts,
      context.completeRegistration.bind(null, identity)
    );
  });
}

function send (client, details, msg, done) {
  client.emit('notification', msg, function(ack){
      console.log("Acknowledgement recieved: " + ack +
                  "\n\tfor message: " + msg +
                  "\n\ton temporary id: " + client.id +
                  "\n\twith client id: " + (details.clientInfo || {}).id
                );
  });
  // send done when we have attempted to send the message,
  // Not when it is aknowledged.
  done();
}

module.exports = function configureSocketIoNotificationChannel(cfg) {
  return function establishSocketIoNotificationChannel(server, sharedSockets) {
    var io = socket_io(server);

    io.on('connection', function (client) {

      requestIdentification({
        client: client,
        getPublicKeyForClient: sharedSockets.getPublicKeyForClient,
        completeRegistration: function(identity, credentials) {
          var details = {
            identity: identity,
            credentials: credentials,
            socket: {}
          };
          details.socket.send = send.bind(null, client, details);

          sharedSockets.completeRegistration(details, function(err, clientInfo) {
              if (err) {
                return console.error(err);
              }

              console.log("Successfully registered: ", clientInfo.id);
          });
        },
        error: function (err, msgToClient) {
          console.error(err);
          if(msgToClient){
            client.emit('error', msgToClient);
          }
        }
      });
    });
  };
}
