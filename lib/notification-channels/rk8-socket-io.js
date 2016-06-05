"use strict";

var socket_io = require("socket.io");

module.exports = function configureSocketIoNotificationChannel(cfg) {
  return function establishSocketIoNotificationChannel(server, registerSocket) {
    var io = socket_io(server);

    io.on('connection', function (socket) {
        var details = {
            ids: [ socket.id ],
            socket: {
                send: function (msg, done) {
                    socket.emit('notification', msg, function(ack){
                        console.log("Acknowledgement recieved: " + ack +
                                    "\n\tfor message: " + msg +
                                    "\n\tto id: " + socket.id);
                    });
                    // send done when we have attempted to send the message,
                    // Not when it is aknowledged.
                    done();
                }
            }
        };
        registerSocket(details, function(err, socketInfo) {
            // emit a proposed id that the client can give out to send notifications
            socket.emit('id', socketInfo.id);
            console.log("Sent socket.id: " + socketInfo.id );

            socket.on('id.ack', function (data) {
                // Recieve back the id that the client actually wants to listen with.
                // These ids will eventually be AMQP queues (or redis or similar) so
                // we can easily go multi-process.
                console.log(data);
            });
        });
    });

  };
}
