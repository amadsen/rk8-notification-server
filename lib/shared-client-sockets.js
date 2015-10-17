
/**
 * Rocket Auth Notification Service - Shared client sockets
 *
 * The purpose of this module is to abstract the process of creating a unique identifier
 * and shared communication channel for a given notification client from the main module.
 * for now it uses a really simple map. In the future it will need to use redis or AMQP
 * or something like it to manage communicating with sockets across processes and servers.
 */
"use strict";
// Dependencies
var path = require("path"),
    uuid = require('uuid');
    
// Variables
var identifierMap = {};

module.exports = {
    register: register,
    send: send
}

function find(bySocketId, done) {
    process.nextTick(function(){
        console.log("Attempting to find socket for id: "+bySocketId);
        var socketInfo = identifierMap[bySocketId];
        if (!(socketInfo && socketInfo.socket && socketInfo.id)) {
            return done( new Error("Can not find socket with referential identifier " + bySocketId + " in this process.") );
        }
        
        return done(null, socketInfo);
    });
}

function create(withSocket, done) {
    process.nextTick(function(){
        var socketInfo = {
                id: uuid.v4(),
                aliases: [],
                socket: withSocket
            };
        identifierMap[ socketInfo.id ] = socketInfo;

        return done(null, socketInfo);
    });
}

/**
 * Register an object with a send(msg, callback) interface to a given set of identifiers.
 * This function may be called multiple times to add identifiers to a socket. Secondary
 * calls should provide a string identifier as socket, referencing the existing socket.
 */
function register (details, done) {
    var fn;
    if("string" === typeof details.socket) {
        fn = find;
    } else if (details.socket && "function" === typeof details.socket.send) {
        fn = create;
    }
    
    if (!fn) {
        return process.nextTick(function(){
            return done( new Error("Unrecognized socket type provided!") );
        });
    }
    
    fn( details.socket, function(err, socketInfo){
        var current,
            alias,
            i, l;
            
        if (err) {
            return done(err);
        }
        // we have found or created our socketInfo
        
        // add any aliases to it
        if (details.ids) {
            for(i = 0, l=details.ids.length; i<l; i++){
                alias = details.ids[i];
                current = identifierMap[ alias ];
                
                if (current) {
                    if (current != socketInfo) {
                        return done( new Error("Socket id " + alias + " already registered!") );
                    }
                    continue;
                }
                /*
                 * Before this can actually be used, we'll want to make sure that the identifiers are
                 * signed by the user or something so we know that the specific user is the one we are
                 * sending the noification to.
                 *
                 * Similarly, there should be an identifier per registered service, so we can invalidate
                 * identifiers on an as needed basis. The current setup is just for testing.
                 *
                 *
                 * ***Idea (based somewhat on U2F concepts)
                 * When a client adds a new identifier, a new keypair is generated on the notification
                 * server. The public key is provided __to the client__ to be forwarded to whatever
                 * notification source they wish (though it is recommended that it be one per
                 * notification source.) The notification source must then encrypt it's notifications
                 * to the client using this public key and sends it to the fully qualified identifier
                 * (which should take the form of a url - https://{fqdn}:optional_port/optional/path/{id}
                 * - or email address - {id}@{fqdn} - where {fqdn} represents the fully qualified domain
                 * name for the notification server. The id@fqdn style could be supportted by a DNS entry
                 * that translates the fqdn to a url.) 
                 * ***
                 */
                identifierMap[ alias ] = socketInfo;
                socketInfo.aliases.push( alias );
            }            
        }
        
        return done(null, { id: socketInfo.id });
    });
}

function send (details, done) {
    if("string" !== typeof details.socket) {
        return done( new Error("Invalid socket identifier " + details.socket + " for this process.") );
    }
    find(details.socket, function(err, socketInfo) {
        if (err) {
            return done(err);
        }
        return socketInfo.socket.send(details.msg, done);
    });
}