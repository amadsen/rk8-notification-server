"use strict";

var request = require('request');

module.exports = function (cfg) {
  var method = cfg.method || "post",
      url = cfg.url || 'http://127.0.0.1/wsapi/ropverify.php';

  if( !/^(get|post)$/.test(method) || 'function' !== typeof(request[method]) ) {
    return null;
  }

  return function( credentials, done ) {
    /*
    credentials should look like this. Either 'pass' OR 'hash' will exist, not both
    {
     user: "a user name",
     pass: "a pass phrase",
     hash: ""
    }
    */
    request[method]({
      url: url,
      form: {
        user: credentials.user,
        password: credentials.pass,
        sflag: 'ldapBindTest'
        // ^-- for now, registering for notifications is user/pass only
        // TODO: make configurble.
      }
    }, function (error, response, body) {
        if (!error && response.statusCode == 200 && /successful/i.test(body) ) {
            return done(null, credentials.user);
        }

        if (error) {
            console.error("ropverify Authentication Error");
            console.error(error);
        }

        // returning an undefined result indicates failure
        return done( null );
    });
  };
}
