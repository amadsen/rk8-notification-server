"use strict";

var fs = require('fs'),
  path = require('path'),
  mkdirp = require('mkdirp'),
  chokidar = require('chokidar');

var cachedPkiMap = {},
  callbackMap = {};

function setCallback(cmd, id, cb){
  function fn(err){
    // clear our timeout
    clearTimeout(timeout);

    // remove ourselves from the callback list
    var idx = callbackMap[id].indexOf(fn);
    if(idx >= 0){
      callbackMap[id].splice(idx, 1);
    }

    if (err) {
      return cb(err);
    }

    if(cachedPkiMap[id]){
      return cb(null, cachedPkiMap[id]);
    }

    cb(new Error('Could not '+cmd+' PKI data for ' + id ));
  }

  var timeout = setTimeout(fn, 250);

  callbackMap[id] = callbackMap[id] || [];
  callbackMap[id].push(fn);
}

function fileNameForId(id) {
  return id + '.json';
}

module.exports = function(cfg) {

  // make sure the pkiDir exists
  var pkiDir = path.resolve( (cfg.dir || './pki_map') );
  mkdirp(pkiDir, function(err){
    if (err) {
      // we can't persist pki info, so crash!
      throw err;
    }

    // TODO: consider moving filewatching and parsing to another process
    chokidar.watch(pkiDir, {
      ignored: '!/*.json',
      depth: 1
    }).on('all', function (event, filePath) {
      var id = path.basename(filePath, '.json');

      function callAllCallbacks(err, data){
        var callbacks = callbackMap[id];
        if(Array.isArray(callbacks)){
          callbacks.forEach(function(fn){
              return fn(err, data);
          });
        }
      }

      console.log(event, filePath);
      fs.readFile(filePath, function (err, data) {
        if (err) {
          // if we can't access the file, assume it was deleted
          // and delete it from our cache
          delete cachedPkiMap[id];

          return callAllCallbacks(err);
        }

        try {
          data = JSON.parse(data);
          cachedPkiMap[id] = data;
        } catch(e) {
          return callAllCallbacks(e);
        }

        callAllCallbacks();
      });
    });
  });

  return {
    get: function getPkiInfo (opts, cb){
      setImmediate(function(){
        if(cachedPkiMap[opts.id]) {
          return cb(null, cachedPkiMap[opts.id]);
        }
        setCallback('find', opts.id, cb);
      });
    },
    set: function setPkiInfo (opts, cb) {
      function finish(err, data) {
        if (!err) {
          console.log('Confirmed successful save and caching of PKI data for '+ opts.id);
        }
        if('function' === typeof cb) {
          cb(err, data);
        }
      }

      var data;
      try {
        data = JSON.stringify(opts.pki, null, 2);
      } catch(e) {
        console.error(err);
        return setImmediate(function(){
          finish(new Error('Could not save invalid PKI data for ' + id ));
        });
      }
      fs.writeFile( path.join(pkiDir, fileNameForId(opts.id)), data, function(err){
        if (err) {
          console.error(err);
          return finish(new Error('Could not save PKI data for ' + id ));
        }
        setCallback('confirm saved', opts.id, finish);
      });
    }
  }
}
