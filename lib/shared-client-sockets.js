
/**
 * Rocket Auth Notification Service - Shared client sockets
 *
 * The purpose of this module is to abstract the process of creating a unique identifier
 * and shared communication channel for a given notification client from the main module.
 * for now it uses really simple maps. In the future it will need to use redis or AMQP
 * or something like it to persist values and manage communicating with sockets
 * across processes and servers.
 */
"use strict";
// Dependencies
var path = require('path'),
    async = require('async'),
    authcheck = require('./authenticate/localhost-ropverify.js'),
    rk8pki = require('rk8-pki');

// Variables
var pkiMap = {}, // <-- socket identifier to PKI notification and authentication keys
    socketMap = {}; // <-- user name to list of sockets. Should be populated from persisted storage

module.exports = {
    getPublicKeyForClient: getPublicKeyForClient,
    completeRegistration: completeRegistration,
    send: send
};

function getPublicKeyForClient (identity, done) {
  // Client flow, step 5.
  // Notification Service attempts to find saved authentication public key
  // using client's (id and) notification public key hash
  var clientPki = pkiMap[identity];

  // if we found it, send it
  if(clientPki) {
    return setImmediate( function () {
      return done(null, clientPki.publicKey);
    });
  }

  // otherwise, generate a new one, save it, and send it
  rk8pki.keypair( function(err, authenticationKeypair) {
    if (err) {
      return done(err);
    }
    // authenticationKeypair.privateKey, authenticationKeypair.publicKey

    // Save this keypair in a pending state!
    pkiMap[identity] = authenticationKeypair;
    pkiMap[identity].timeout = setTimeout( function(){
      // By passing in just the identity we trigger a failed registration
      // which will delete the entry from the pkiMap unless it already has a
      // notificationPublicKey.
      completeRegistration({ identity: identity });
    }, 5000);

    return done(null, {
      key: authenticationKeypair.publicKey
    });
  });

}

/**
 * Register an object with a send(msg, callback) interface to an identity.
 */
function completeRegistration (details, done) {
  /*
  Notification Service decrypts authentication tokens. Verify signature. Use
  authentication hash to look up user (or employ other authentication services
  to verify user). If user is found (and authenticated), save notification
  public key for lookup by client (id and) hash of notification public key.

  If other notification clients already exist for the user and server is so
  configured, send a notification to the other clients and get confirmation
  from at least one before saving the new notification key.

  Alternatively, use 2FA server after lookup of user.

  It is preferred that the notification server never have access to the actual
  password, but if needed for 2FA, it or another authentication token can be
  sent instead of the username/password hash.
  */

  var clientPki = pkiMap[details.identity],
      credentials;

  // If our timeout passed in just the identity we trigger a failed
  // registration which will delete the entry from the pkiMap unless it already
  // has a notificationPublicKey.
  if(!details.credentials && !clientPki.notificationPublicKey) {
    return delete pkiMap[details.identity];
  }

  // decrypt details.credentials with a private key
  try {
    credentials = JSON.parse(
      rk8pki.decrypt( details.credentials, clientPki.privateKey )
    );
  } catch (e) {
    return done(e);
  }
  delete details.credentials;

  /*
  credentials should look like this. Either 'pass' OR 'hash' will exist, not both
  {
   user: "a user name",
   pass: "a pass phrase",
   hash: "",
   key: "notification public key"
  }
  */
  authcheck(credentials, function(err, user){

    cancelTimeout( clientPki.timeout );
    delete clientPki.timeout;

    if (!user) {
      if(!clientPki.notificationPublicKey) {
        delete pkiMap[details.identity];
      }
      return;
    }

    if(!clientPki.notificationPublicKey) {
      clientPki.notificationPublicKey = credentials.key;
    }
    details.key = clientPki.notificationPublicKey;
    socketMap[user] = socketMap[user] || [];
    socketMap[user].push(details);
  });

}

function send(details, done) {
  sendToUser(details, done);
}

function sendToUser (details, done) {
    if("string" !== typeof details.username) {
        return done( new Error("Invalid client username " + details.username + " for this process.") );
    }
    findSocketsForUser(details.username, function(err, socketInfoList) {
        if (err) {
            return done(err);
        }
        async.each( socketInfoList, function (socketInfo, next) {
          try {
            socketInfo.socket.send(
              rk8pki.encrypt( details.msg, socketInfo.key ),
              next
            );
          } catch(e) {
            console.error('Error sending msg to socket', socketInfo);
            // allow sending to other sockets.
            next();
          }
        }, done);
    });
}

function findSocketsForUser(user, done) {
    setImmediate( function(){
        console.log("Attempting to find sockets for: " + user);
        var socketInfoList = socketMap[user];
        if (!socketInfoList || socketInfoList.length === 0) {
            return done( new Error("Can not find any sockets for user " + user + " in this process.") );
        }

        return done(null, socketInfoList);
    });
}
