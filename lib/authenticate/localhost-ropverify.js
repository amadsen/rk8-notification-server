"use strict";

var request = require('request');

module.exports = function( credentials, done ) {
  /*
  credentials should look like this. Either 'pass' OR 'hash' will exist, not both
  {
   user: "a user name",
   pass: "a pass phrase",
   hash: "",
   key: "notification public key"
  }
  */
  request.post({
    url: 'http://127.0.0.1/wsapi/ropverify.php',
    form: {
      user: credentials.user,
      password: credentials.pass,
      sflag: 'ldapBindTest'
      // ^-- for now, registering for notifications is user/pass only
      // TODO: make configurble.
    }
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      if( /successful/i.test(body) ) {
        done(null, credentails.user);
      }
    }
  })
}
