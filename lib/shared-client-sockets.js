
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
    rk8pki = require('rk8-pki'),
    initAuthCheck = require('./init-auth-check.js'),
    initPersistentPkiMap = require('./init-persistent-pki-map.js');

module.exports = function configureSharedSockets(cfg) {

  // initialize our authentication function
  var authcheck = initAuthCheck(cfg.authenticate),
  // Initialize our persistent socket identifier to PKI notification
  // and authentication keys mapping.
      persistentPkiMap = initPersistentPkiMap(cfg.persistence);

  // Variables
  var pkiMap = {}, // local pending socket identifier to PKI notification and authentication keys mapping
      socketMap = {}, // <-- user name to list of sockets. Should be populated from persisted storage
      pendingNotificationKeys = {}; // <- identity to notification public key while awaiting authentication info

  function getPublicKeyForClient (identity, done) {
    // Client flow, step 5.
    // Notification Service attempts to find saved authentication public key
    // using client's (id and) notification public key hash
    console.log('Getting public key for', identity);
    persistentPkiMap.get({id:identity}, function(err, clientPki){
      // if we found it, send it
      if(clientPki) {
        // get our local copy
        pkiMap[identity] = clientPki;
        return setImmediate( function () {
          console.log('Found public key for', identity);
          return done(null, {
            key: clientPki.publicKey
          });
        });
      }

      // We did not find it. Generate a new one.
      console.log('Generating new public key for', identity);
      // otherwise, generate a new one, save it, and send it
      rk8pki.keypair( function(err, authenticationKeypair) {
        if (err) {
          console.warn('Error generating public key for', identity);
          return done(err);
        }
        // authenticationKeypair.privateKey, authenticationKeypair.publicKey

        // Save this keypair in a pending state!
        pkiMap[identity] = authenticationKeypair;
        pkiMap[identity].timeout = setTimeout( function(){
          // By passing in just the identity we trigger a failed registration
          // which will delete the entry from the pkiMap unless it already has a
          // notificationPublicKey.
          recieveNotificationKey({ identity: identity }, function noop(){});
          completeRegistration({ identity: identity }, function noop(){});
        }, 120000); // registration timeouts need to be long to account for key generation time

        return done(null, {
          key: authenticationKeypair.publicKey
        });
      });

    });
  }

  function recieveNotificationKey (details, finish) {
    function done (err, data) {
      // cleanup the pkiMap if we had an error, unless it already
      // has a notificationPublicKey (which must belong to a successfully
      // registered socket).
      if(err && pkiMap[details.identity] && !pkiMap[details.identity].notificationPublicKey){
         delete pkiMap[details.identity];
      }

      return finish(err, data);
    }

    var clientPki = pkiMap[details.identity],
        notificationInfo,
        encryptedResponse;

    if (!clientPki) {
      console.warn(
        'Attempt to recieve notification key for unrecognized identity', details.identity
      );
      return done( new Error(
          'Attempt to recieve notification key for unrecognized identity ' + details.identity
      ) );
    }

    console.log('Recieving notification key for', details.identity);

    // If our timeout passed in just the identity we trigger a failed
    // registration which will delete the entry from the pkiMap unless it already
    // has a notificationPublicKey.
    if(!details.notificationInfo) {
      console.warn('Timeout or null registration for', details.identity);

      // cancel the timeout in case this wasn't triggerred via timeout
      clearTimeout( clientPki.timeout );
      return done(new Error('Timeout getting notification key from client for ' + details.identity));
    }

    // decrypt details.notificationInfo with a private key
    console.log('Notification Info', details.notificationInfo);
    try {
      notificationInfo = JSON.parse(
        rk8pki.decrypt( details.notificationInfo, clientPki.privateKey )
      );
    } catch (e) {
      console.warn('Error decrypting notification key for', details.identity);
      return done(e);
    }
    delete details.notificationInfo;

    console.log('Recieved notification info for', details.identity, notificationInfo);

    // reset our timeout for collecting authentication info
    clearTimeout( clientPki.timeout );
    clientPki.timeout = setTimeout( function(){
      // By passing in just the identity we trigger a failed registration
      // which will delete the entry from the pkiMap unless it already has a
      // notificationPublicKey.
      completeRegistration({ identity: identity }, function noop(){});
    }, 15000);
    /*
    notificationInfo should look like this:
    {
     nonce: "a random string that should be encrypted and sent back to the client",
     key: "notification public key"
    }
    */

    // If the client changed the notificationPublicKey for this id,
    // we still use the original. This primarily distinguishes between a new
    // registration and a returning client. Therefore, only save the sent
    // notification public key if none exists for this client identity.
    pendingNotificationKeys[details.identity] = clientPki.notificationPublicKey || notificationInfo.key;

    // prove to the client that we still have the registered notification
    // public key (or recognize this as a registration) by encrypting the
    // nonce with the correct key
    try {
      encryptedResponse = rk8pki.encrypt(
        JSON.stringify({
          nonce: notificationInfo.nonce
        }),
        pendingNotificationKeys[details.identity]
      );
    } catch(e) {
      console.error('Error sending encrypted nonce for', details.identity, e);
      return done(new Error('Error sending encrypted nonce for '+ details.identity));
    }

    return done(null, encryptedResponse);
  }

  /**
   * Register an object with a send(msg, callback) interface to an identity.
   */
  function completeRegistration (details, finish) {
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
    function done (err, data) {
      // always clean up pendingNotificationKeys
      delete pendingNotificationKeys[details.identity];

      // cleanup the pkiMap too, unless it already
      // has a notificationPublicKey (which must belong to a successfully
      // registered socket).
      if(pkiMap[details.identity] && !pkiMap[details.identity].notificationPublicKey){
         delete pkiMap[details.identity];
      }

      return finish(err, data);
    }

    var clientPki = pkiMap[details.identity],
        credentials;

    if (!clientPki) {
      console.warn(
        'Attempt to complete registration for unrecognized identity', details.identity
      );
      return done( new Error(
          'Attempt to complete registration for unrecognized identity ' + details.identity
      ) );
    }

    console.log('Completing registration for', details.identity);

    // If our timeout passed in just the identity we trigger a failed
    // registration.
    if(!details.credentials) {
      console.warn('Timeout or null registration for', details.identity);

      // cancel the timeout in case this wasn't triggerred via timeout
      clearTimeout( clientPki.timeout );
      return done(new Error('Timeout getting credentials from client for ' + details.identity));
    }

    // decrypt details.credentials with a private key
    try {
      credentials = JSON.parse(
        rk8pki.decrypt( details.credentials, clientPki.privateKey )
      );
    } catch (e) {
      console.warn('Error decrypting registration credentials for', details.identity);
      return done(e);
    }
    delete details.credentials;

    console.log('Recieved registration credentials for', details.identity, credentials);

    // reset our timeout for just the authcheck API
    clearTimeout( clientPki.timeout );
    clientPki.timeout = setTimeout( function(){
      console.log('Timeout getting login results for', details.identity);

      return done(new Error('Timeout getting login results for ' + details.identity));
    }, 15000);
    /*
    credentials should look like this. Either 'pass' OR 'hash' will exist, not both
    {
     user: "a user name",
     pass: "a pass phrase",
     hash: ""
    }
    */

    authcheck(credentials, function(err, user){
      if (err) {
        console.error('Authentication error.');
        return done(err);
      }

      if(!pendingNotificationKeys[details.identity]){
        return console.warn('Recieved login results after timeout for', details.identity);
        // DO NOT call callback here - it has already been called!
      }

      console.log('Recieved login results for', details.identity);
      clearTimeout( clientPki.timeout );
      delete clientPki.timeout;

      if (!user) {
        console.log('Failed login for', details.identity);
        return done(new Error('Failed login for ' + details.identity));;
      }

      console.log('Successful registration login for', details.identity);

      // only save the new notificationPublicKey if we don't already have one
      if(!clientPki.notificationPublicKey) {
        clientPki.notificationPublicKey = pendingNotificationKeys[details.identity];
      }
      details.key = clientPki.notificationPublicKey;
      persistentPkiMap.set({
        id: details.identity,
        pki: clientPki
      });
      socketMap[user] = socketMap[user] || [];
      socketMap[user].push(details);

      return done(null, {id: details.identity, user: user});
    });

  }

  function send(details, done) {
    sendToUser(details, done);
  }

  function getAckId (socketInfo, idIsFor) {
    idIsFor = idIsFor || 'ack';

    // TODO: make this a cryptographic hash or uuid.v4
    return [
      idIsFor,
      socketInfo.identity,
      Math.random()
    ].concat(process.hrtime()).join('|');
  }

  function acknowledgeSend(details, socketInfo, err, acknowledement){
    function callAckFn(err, ack) {
      if (err) {
        console.error(
          'Error recieving acknowledgement', err,
          "\n\tfor user: " + details.username +
          "\n\ton socket: " + socketInfo.identity
        );
      }

      if('function' === typeof details.ackFn){
        details.ackFn(err, ack);
      }
    }

    if (err) {
      return callAckFn(err);
    }

    persistentPkiMap.get({id: socketInfo.identity}, function(err, clientPki){
      var ack;

      if(!err){
        try{
          ack = rk8pki.decrypt(acknowledement, clientPki.privateKey);
          console.log(
            "Acknowledgement recieved: " + ack +
            "\n\tfor user: " + details.username +
            "\n\ton socket: " + socketInfo.identity
          );
        } catch(e) {
          err = e;
        }
      }

      return callAckFn(err, ack);
    });
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
            var id = 'function' === typeof details.ackFn? getAckId(socketInfo, details.type) : null,
              rawData = {},
              sendOpts = {};

            rawData.msg = details.msg;
            rawData.url = details.url;

            // if ack requested, package up the actual message
            // with the id and our acknowledgeSend function.
            if(id){
              rawData.id = id;
              sendOpts = {
                ackFn: function (err, data) {
                  acknowledgeSend(details, socketInfo, err, data);
                },
                id: id
              }
            }

            // encrypt the rawData
            try {
              sendOpts.data = rk8pki.encrypt(
                JSON.stringify(rawData),
                socketInfo.key
              );

              // send away!
              socketInfo.socket.send(
                sendOpts,
                next // <-- called when message is sent, not acknowledged
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

  return {
      getPublicKeyForClient: getPublicKeyForClient,
      recieveNotificationKey: recieveNotificationKey,
      completeRegistration: completeRegistration,
      send: send
  };

}
