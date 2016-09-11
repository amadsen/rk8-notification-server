"use strict";

var path = require('path'),
    async = require('async');

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
      function (authInfo, cb) {
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
      function (err, allResults) {
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

module.exports = prepareAuthCheck;
