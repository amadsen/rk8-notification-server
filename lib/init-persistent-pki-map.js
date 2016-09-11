"use strict";

var path = require('path');

module.exports = function (cfg) {
  var module = require(path.join('..', cfg.module))(cfg.opts);
  return {
    get: function getPkiInfo (opts, cb) {
      module.get(opts, cb);
    },
    set: function setPkiInfo (opts, cb) {
      module.set(opts, cb);
    }
  }
}
