
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
    rk8pki = require('rk8-pki');

function prepareAuthCheck (authCfg) {
  authCfg = authCfg || {};
  authCfg.modules = authCfg.modules || {};

  var authModules = Object.keys(authCfg.modules)
    .map( function (moduleName) {
      var moduleCfg = authCfg.modules[moduleName];
      return ('function' === typeof(moduleCfg))? moduleCfg : (
        function(moduleName, moduleCfg){
          var where = (/^\w/.test(moduleName)? moduleName : path.join('..', moduleName));
          try {
            return {
              module: require(where)(moduleCfg),
              name: moduleName
            };
          } catch (e) {
            console.warn("Unable to initialize authentication module: ", moduleName, moduleCfg);
          }
        }
      )(moduleName, moduleCfg);
    })
    .filter( function (authInfo) {
      return (authInfo && 'function' === typeof authInfo.module);
    });

  if(authModules.length < 1){
    throw new Error('No successfully initialized authentication modules!');
  }

  return function authcheck( credentials, done ) {
    return async.map(
      authModules,
      (authInfo, cb) => {
        authInfo.module(credentials, (err, result) => {
          if (err) {
            return cb(err);
          }

          return cb(null, {
            name: authInfo.name,
            result
          })
        });
      },
      (err, allResults) => {
        if (err) {
          return done(err);
        }
        /*
         TODO: support multiple configurations for combining multiple
         authentication modules' results.
         */
        if( allResults.some( (authInfo) => { return !authInfo.result; }) ) {
          return done( new Error('Failed authentication with module ' + name) );
        }

        return done(null, credentials.user);
      }
    );
  };
}

module.exports = function configureSharedSockets(cfg) {

  var authcheck = prepareAuthCheck(cfg.authenticate);

  // Variables
  var pkiMap = {}, // <-- socket identifier to PKI notification and authentication keys
      socketMap = {}; // <-- user name to list of sockets. Should be populated from persisted storage

  function getPublicKeyForClient (identity, done) {
    // Client flow, step 5.
    // Notification Service attempts to find saved authentication public key
    // using client's (id and) notification public key hash
    var clientPki = pkiMap[identity];

    console.log('Getting public key for', identity);

    // if we found it, send it
    if(clientPki) {
      return setImmediate( function () {
        console.log('Found public key for', identity);
        return done(null, clientPki.publicKey);
      });
    }

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
        completeRegistration({ identity: identity }, function noop(){});
      }, 120000); // registration timeouts need to be long to account for key generation time

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

    if (!clientPki) {
      return console.warn(
        'Attempt to complete registration for unrecognized identity', details.identity
      );
    }

    console.log('Completing registration for', details.identity);

    console.log(pkiMap);

    // If our timeout passed in just the identity we trigger a failed
    // registration which will delete the entry from the pkiMap unless it already
    // has a notificationPublicKey.
    if(!details.credentials) {
      console.warn('Timeout or null registration for', details.identity);

      if(!pkiMap[details.identity].notificationPublicKey){
         delete pkiMap[details.identity];
      }

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
      if(pkiMap[details.identity] && !pkiMap[details.identity].notificationPublicKey){
        delete pkiMap[details.identity];
      }
      return done(new Error('Timeout getting login results for ' + details.identity));
    }, 15000);
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
      if (err) {
        console.error('Authentication error.');
        return done(err);
      }

      if(!pkiMap[details.identity]){
        return console.warn('Recieved login results after timeout for', details.identity);
        // DO NOT call callback here - it has already been called!
      }

      console.log('Recieved login results for', details.identity);
      clearTimeout( clientPki.timeout );
      delete clientPki.timeout;

      if (!user) {
        console.log('Failed login for', details.identity);
        if(!clientPki.notificationPublicKey) {
          delete pkiMap[details.identity];
        }
        return done(new Error('Failed login for ' + details.identity));;
      }

      console.log('Successful registration login for', details.identity);

      if(!clientPki.notificationPublicKey) {
        clientPki.notificationPublicKey = credentials.key;
      }
      details.key = clientPki.notificationPublicKey;
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
    var clientPki = pkiMap[socketInfo.identity],
        ack;

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

  function sendToUser (details, done) {
      if("string" !== typeof details.username) {
          return done( new Error("Invalid client username " + details.username + " for this process.") );
      }
      findSocketsForUser(details.username, function(err, socketInfoList) {
          if (err) {
              return done(err);
          }
          async.each( socketInfoList, function (socketInfo, next) {
            var id = getAckId(socketInfo, details.type);
            try {
              // package up the actual message with the id and our
              // acknowledgeSend function.
              socketInfo.socket.send({
                  data: rk8pki.encrypt( JSON.stringify({
                    msg: details.msg,
                    id: id
                  }), socketInfo.key ),
                  ackFn: function (err, data) {
                    acknowledgeSend(details, socketInfo, err, data);
                  },
                  id: id
                },
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
      completeRegistration: completeRegistration,
      send: send
  };

}
