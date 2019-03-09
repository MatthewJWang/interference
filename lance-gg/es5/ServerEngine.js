var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

import fs from 'fs';
import Utils from './lib/Utils';
import Scheduler from './lib/Scheduler';
import Serializer from './serialize/Serializer';
import NetworkTransmitter from './network/NetworkTransmitter';
import NetworkMonitor from './network/NetworkMonitor';

// MJW ADDITIONS
import SyncServer from '@ircam/sync/server';

/**
 * ServerEngine is the main server-side singleton code.
 * Extend this class with your own server-side logic, and
 * start a single instance.
 *
 * This class should not be used to contain the actual
 * game logic.  That belongs in the GameEngine class, where the mechanics
 * of the gameplay are actually implemented.
 * The ServerEngine singleton is typically a lightweight
 * implementation, logging gameplay statistics and registering
 * user activity and user data.
 *
 * The base class implementation is responsible for starting
 * the server, initiating each game step, accepting new
 * connections and dis-connections, emitting periodic game-state
 * updates, and capturing remote user inputs.
 */

var ServerEngine = function () {

    /**
     * create a ServerEngine instance
     *
     * @param {SocketIO} io - the SocketIO server
     * @param {GameEngine} gameEngine - instance of GameEngine
     * @param {Object} options - server options
     * @param {Number} options.stepRate - number of steps per second
     * @param {Number} options.updateRate - number of steps in each update (sync)
     * @param {String} options.tracesPath - path where traces should go
     * @param {Boolean} options.updateOnObjectCreation - should send update immediately when new object is created
     * @param {Number} options.timeoutInterval=180 - number of seconds after which a player is automatically disconnected if no input is received. Set to 0 for no timeout
     * @return {ServerEngine} serverEngine - self
     */
    function ServerEngine(io, gameEngine, options) {
        var _this = this;

        _classCallCheck(this, ServerEngine);

        this.options = Object.assign({
            updateRate: 6,
            stepRate: 60,
            timeoutInterval: 180,
            updateOnObjectCreation: true,
            tracesPath: '',
            debug: {
                serverSendLag: false
            }
        }, options);
        if (this.options.tracesPath !== '') {
            this.options.tracesPath += '/';
            require('mkdirp').sync(this.options.tracesPath);
        }

        this.io = io;

        /**
         * reference to game engine
         * @member {GameEngine}
         */
        this.serializer = new Serializer();
        this.gameEngine = gameEngine;
        this.gameEngine.registerClasses(this.serializer);
        this.networkTransmitter = new NetworkTransmitter(this.serializer);
        this.networkMonitor = new NetworkMonitor();

        /**
         * Default room name
         * @member {String} DEFAULT_ROOM_NAME
         */
        this.DEFAULT_ROOM_NAME = '/lobby';
        this.rooms = {};
        this.createRoom(this.DEFAULT_ROOM_NAME);
        this.connectedPlayers = {};
        this.playerInputQueues = {};
        this.pendingAtomicEvents = [];
        this.objMemory = {};

        io.on('connection', this.onPlayerConnected.bind(this));
        this.gameEngine.on('objectAdded', this.onObjectAdded.bind(this));
        this.gameEngine.on('objectDestroyed', this.onObjectDestroyed.bind(this));

        // MJW: sync init
        this.startTime = process.hrtime();

        this.syncServer = new SyncServer(function () {
            var now = process.hrtime(_this.startTime);
            return now[0] + now[1] * 1e-9;
        });

        return this;
    }

    // start the ServerEngine


    _createClass(ServerEngine, [{
        key: 'start',
        value: function start() {
            var _this2 = this;

            this.gameEngine.start();
            this.gameEngine.emit('server__init');

            var schedulerConfig = {
                tick: this.step.bind(this),
                period: 1000 / this.options.stepRate,
                delay: 4
            };
            // MJW: added sync argument
            this.scheduler = new Scheduler(schedulerConfig, function () {
                return _this2.syncServer.getSyncTime() * 1000;
            }).start();
        }

        // every server step starts here

    }, {
        key: 'step',
        value: function step() {
            var _this3 = this;

            // first update the trace state
            this.gameEngine.trace.setStep(this.gameEngine.world.stepCount + 1);
            this.gameEngine.emit('server__preStep', this.gameEngine.world.stepCount + 1);

            // MJW: now use sync instead of Date
            this.serverTime = this.syncServer.getSyncTime() * 1000;

            // for each player, replay all the inputs in the oldest step

            var _loop = function _loop(playerIdStr) {
                var playerId = Number(playerIdStr);
                var inputQueue = _this3.playerInputQueues[playerId];
                var queueSteps = Object.keys(inputQueue);
                var minStep = Math.min.apply(null, queueSteps);

                // check that there are inputs for this step,
                // and that we have reached/passed this step
                if (queueSteps.length > 0 && minStep <= _this3.gameEngine.world.stepCount) {
                    inputQueue[minStep].forEach(function (input) {
                        _this3.gameEngine.emit('server__processInput', { input: input, playerId: playerId });
                        _this3.gameEngine.emit('processInput', { input: input, playerId: playerId });
                        _this3.gameEngine.processInput(input, playerId, true);
                    });
                    delete inputQueue[minStep];
                }
            };

            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = Object.keys(this.playerInputQueues)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var playerIdStr = _step.value;

                    _loop(playerIdStr);
                }

                // run the game engine step
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            this.gameEngine.step(false, this.serverTime / 1000);

            // synchronize the state to all clients
            Object.keys(this.rooms).map(this.syncStateToClients.bind(this));

            // remove memory-objects which no longer exist
            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;

            try {
                for (var _iterator2 = Object.keys(this.objMemory)[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var objId = _step2.value;

                    if (!(objId in this.gameEngine.world.objects)) {
                        delete this.objMemory[objId];
                    }
                }

                // step is done on the server side
            } catch (err) {
                _didIteratorError2 = true;
                _iteratorError2 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion2 && _iterator2.return) {
                        _iterator2.return();
                    }
                } finally {
                    if (_didIteratorError2) {
                        throw _iteratorError2;
                    }
                }
            }

            this.gameEngine.emit('server__postStep', this.gameEngine.world.stepCount);

            if (this.gameEngine.trace.length) {
                var traceData = this.gameEngine.trace.rotate();
                var traceString = '';
                traceData.forEach(function (t) {
                    traceString += '[' + t.time.toISOString() + ']' + t.step + '>' + t.data + '\n';
                });
                fs.appendFile(this.options.tracesPath + 'server.trace', traceString, function (err) {
                    if (err) throw err;
                });
            }
        }
    }, {
        key: 'syncStateToClients',
        value: function syncStateToClients(roomName) {
            var _this4 = this;

            // update clients only at the specified step interval, as defined in options
            // or if this room needs to sync
            var room = this.rooms[roomName];
            if (room.requestImmediateSync || this.gameEngine.world.stepCount % this.options.updateRate === 0) {

                var roomPlayers = Object.keys(this.connectedPlayers).filter(function (p) {
                    return _this4.connectedPlayers[p].roomName === roomName;
                });

                // if at least one player is new, we should send a full payload
                var diffUpdate = true;
                var _iteratorNormalCompletion3 = true;
                var _didIteratorError3 = false;
                var _iteratorError3 = undefined;

                try {
                    for (var _iterator3 = roomPlayers[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                        var socketId = _step3.value;

                        var player = this.connectedPlayers[socketId];
                        if (player.state === 'new') {
                            player.state = 'synced';
                            diffUpdate = false;
                        }
                    }

                    // also, one in twenty syncs is a full update
                } catch (err) {
                    _didIteratorError3 = true;
                    _iteratorError3 = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion3 && _iterator3.return) {
                            _iterator3.return();
                        }
                    } finally {
                        if (_didIteratorError3) {
                            throw _iteratorError3;
                        }
                    }
                }

                if (room.syncCounter++ % 20 === 0) diffUpdate = false;

                var payload = this.serializeUpdate(roomName, { diffUpdate: diffUpdate });
                this.gameEngine.trace.info(function () {
                    return '========== sending world update ' + _this4.gameEngine.world.stepCount + ' to room ' + roomName + ' is delta update: ' + diffUpdate + ' ==========';
                });
                var _iteratorNormalCompletion4 = true;
                var _didIteratorError4 = false;
                var _iteratorError4 = undefined;

                try {
                    for (var _iterator4 = roomPlayers[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
                        var _socketId = _step4.value;

                        this.connectedPlayers[_socketId].socket.emit('worldUpdate', payload);
                    }
                } catch (err) {
                    _didIteratorError4 = true;
                    _iteratorError4 = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion4 && _iterator4.return) {
                            _iterator4.return();
                        }
                    } finally {
                        if (_didIteratorError4) {
                            throw _iteratorError4;
                        }
                    }
                }

                this.networkTransmitter.clearPayload();
                room.requestImmediateSync = false;
            }
        }

        // create a serialized package of the game world
        // TODO: this process could be made much much faster if the buffer creation and
        //       size calculation are done in a single phase, along with string pruning.

    }, {
        key: 'serializeUpdate',
        value: function serializeUpdate(roomName, options) {
            var world = this.gameEngine.world;
            var diffUpdate = Boolean(options && options.diffUpdate);

            // add this sync header
            // currently this is just the sync step count
            this.networkTransmitter.addNetworkedEvent('syncHeader', {
                stepCount: world.stepCount,
                // MJW: added playerCount to sync header
                playerCount: world.playerCount,
                fullUpdate: Number(!diffUpdate)
            });

            var roomObjects = Object.keys(world.objects).filter(function (o) {
                return world.objects[o]._roomName === roomName;
            });
            var _iteratorNormalCompletion5 = true;
            var _didIteratorError5 = false;
            var _iteratorError5 = undefined;

            try {
                for (var _iterator5 = roomObjects[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
                    var objId = _step5.value;

                    var obj = world.objects[objId];
                    var prevObject = this.objMemory[objId];

                    // if the object (in serialized form) hasn't changed, move on
                    if (diffUpdate) {
                        var s = obj.serialize(this.serializer);
                        if (prevObject && Utils.arrayBuffersEqual(s.dataBuffer, prevObject)) continue;else this.objMemory[objId] = s.dataBuffer;

                        // prune strings which haven't changed
                        obj = obj.prunedStringsClone(this.serializer, prevObject);
                    }

                    this.networkTransmitter.addNetworkedEvent('objectUpdate', {
                        stepCount: world.stepCount,
                        objectInstance: obj
                    });
                }
            } catch (err) {
                _didIteratorError5 = true;
                _iteratorError5 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion5 && _iterator5.return) {
                        _iterator5.return();
                    }
                } finally {
                    if (_didIteratorError5) {
                        throw _iteratorError5;
                    }
                }
            }

            return this.networkTransmitter.serializePayload();
        }

        /**
         * Create a room
         *
         * There is a default room called "/lobby".  All newly created players
         * and objects are assigned to the default room.  When the server sends
         * periodic syncs to the players, each player is only sent those objects
         * which are present in his room.
         *
         * @param {String} roomName - the new room name
         */

    }, {
        key: 'createRoom',
        value: function createRoom(roomName) {
            this.rooms[roomName] = { syncCounter: 0, requestImmediateSync: false };
        }

        /**
         * Assign an object to a room
         *
         * @param {Object} obj - the object to move
         * @param {String} roomName - the target room
         */

    }, {
        key: 'assignObjectToRoom',
        value: function assignObjectToRoom(obj, roomName) {
            obj._roomName = roomName;
        }

        /**
         * Assign a player to a room
         *
         * @param {Number} playerId - the playerId
         * @param {String} roomName - the target room
         */

    }, {
        key: 'assignPlayerToRoom',
        value: function assignPlayerToRoom(playerId, roomName) {
            var room = this.rooms[roomName];
            var player = null;
            if (!room) {
                this.gameEngine.trace.error(function () {
                    return 'cannot assign player to non-existant room ' + roomName;
                });
            }
            var _iteratorNormalCompletion6 = true;
            var _didIteratorError6 = false;
            var _iteratorError6 = undefined;

            try {
                for (var _iterator6 = Object.keys(this.connectedPlayers)[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
                    var p = _step6.value;

                    if (this.connectedPlayers[p].socket.playerId === playerId) player = this.connectedPlayers[p];
                }
            } catch (err) {
                _didIteratorError6 = true;
                _iteratorError6 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion6 && _iterator6.return) {
                        _iterator6.return();
                    }
                } finally {
                    if (_didIteratorError6) {
                        throw _iteratorError6;
                    }
                }
            }

            if (!player) {
                this.gameEngine.trace.error(function () {
                    return 'cannot assign non-existant playerId ' + playerId + ' to room ' + roomName;
                });
            }
            var roomUpdate = { playerId: playerId, from: player.roomName, to: roomName };
            player.socket.emit('roomUpdate', roomUpdate);
            this.gameEngine.emit('server__roomUpdate', roomUpdate);
            this.gameEngine.trace.info(function () {
                return 'ROOM UPDATE: playerId ' + playerId + ' from room ' + player.roomName + ' to room ' + roomName;
            });
            player.roomName = roomName;
        }

        // handle the object creation

    }, {
        key: 'onObjectAdded',
        value: function onObjectAdded(obj) {
            obj._roomName = obj._roomName || this.DEFAULT_ROOM_NAME;
            this.networkTransmitter.addNetworkedEvent('objectCreate', {
                stepCount: this.gameEngine.world.stepCount,
                objectInstance: obj
            });

            if (this.options.updateOnObjectCreation) {
                this.rooms[obj._roomName].requestImmediateSync = true;
            }
        }

        // handle the object creation

    }, {
        key: 'onObjectDestroyed',
        value: function onObjectDestroyed(obj) {
            this.networkTransmitter.addNetworkedEvent('objectDestroy', {
                stepCount: this.gameEngine.world.stepCount,
                objectInstance: obj
            });
        }
    }, {
        key: 'getPlayerId',
        value: function getPlayerId(socket) {
            return this.gameEngine.world.getNewId();
        }

        // handle new player connection

    }, {
        key: 'onPlayerConnected',
        value: function onPlayerConnected(socket) {
            var that = this;

            console.log('Client connected');

            // save player
            this.connectedPlayers[socket.id] = {
                socket: socket,
                state: 'new',
                roomName: this.DEFAULT_ROOM_NAME
            };

            var playerId = this.getPlayerId(socket);
            // MJW always increment playerCount when a player connects
            this.gameEngine.world.playerCount++;
            if (!playerId) {
                playerId = this.gameEngine.world.playerCount;
            }
            socket.playerId = playerId;

            socket.lastHandledInput = null;

            // MJW: incorporating ircam/sync
            this.syncServer.start(
            // sync send function
            function (pingId, clientPingTime, serverPingTime, serverPongTime) {
                //console.log(`[pong] - id: %s, clientPingTime: %s, serverPingTime: %s, serverPongTime: %s`,
                //  pingId, clientPingTime, serverPingTime, serverPongTime);
                var response = [];
                response[0] = 1; // this is a pong
                response[1] = pingId;
                response[2] = clientPingTime;
                response[3] = serverPingTime;
                response[4] = serverPongTime;
                socket.emit('syncServerData', response);
            },
            //sync receive function
            function (callback) {
                socket.on('syncClientData', function (data) {
                    var request = data;

                    if (request[0] === 0) {
                        // this is a ping
                        var pingId = request[1];
                        var clientPingTime = request[2];

                        //console.log(`[ping] - pingId: %s, clientPingTime: %s`, clientPingTime);

                        callback(pingId, clientPingTime);
                    }
                });
            });
            // end MJW

            socket.joinTime = this.syncServer.getSyncTime() * 1000;
            this.resetIdleTimeout(socket);

            console.log('Client Connected', socket.id);

            var playerEvent = { id: socket.id, playerId: playerId, joinTime: socket.joinTime, disconnectTime: 0 };
            this.gameEngine.emit('server__playerJoined', playerEvent);
            this.gameEngine.emit('playerJoined', playerEvent);
            socket.emit('playerJoined', playerEvent);

            socket.on('disconnect', function () {
                playerEvent.disconnectTime = that.syncServer.getSyncTime() * 1000;
                that.onPlayerDisconnected(socket.id, playerId);
                that.gameEngine.emit('server__playerDisconnected', playerEvent);
                that.gameEngine.emit('playerDisconnected', playerEvent);
            });

            // todo rename, use number instead of name
            socket.on('move', function (data) {
                that.onReceivedInput(data, socket);
            });

            // we got a packet of trace data, write it out to a side-file
            socket.on('trace', function (traceData) {
                traceData = JSON.parse(traceData);
                var traceString = '';
                traceData.forEach(function (t) {
                    traceString += '[' + t.time + ']' + t.step + '>' + t.data + '\n';
                });
                fs.appendFile(that.options.tracesPath + 'client.' + playerId + '.trace', traceString, function (err) {
                    if (err) throw err;
                });
            });

            this.networkMonitor.registerPlayerOnServer(socket);
        }

        // handle player timeout

    }, {
        key: 'onPlayerTimeout',
        value: function onPlayerTimeout(socket) {
            console.log('Client timed out after ' + this.options.timeoutInterval + ' seconds', socket.id);
            socket.disconnect();
        }

        // handle player dis-connection

    }, {
        key: 'onPlayerDisconnected',
        value: function onPlayerDisconnected(socketId, playerId) {
            delete this.connectedPlayers[socketId];
            // MJW: decrement playerCount
            this.gameEngine.world.playerCount--;
            console.log('Client disconnected');
        }

        // resets the idle timeout for a given player

    }, {
        key: 'resetIdleTimeout',
        value: function resetIdleTimeout(socket) {
            var _this5 = this;

            if (socket.idleTimeout) clearTimeout(socket.idleTimeout);
            if (this.options.timeoutInterval > 0) {
                socket.idleTimeout = setTimeout(function () {
                    _this5.onPlayerTimeout(socket);
                }, this.options.timeoutInterval * 1000);
            }
        }

        // add an input to the input-queue for the specific player
        // each queue is key'd by step, because there may be multiple inputs
        // per step

    }, {
        key: 'queueInputForPlayer',
        value: function queueInputForPlayer(data, playerId) {

            // create an input queue for this player, if one doesn't already exist
            if (!this.playerInputQueues.hasOwnProperty(playerId)) this.playerInputQueues[playerId] = {};
            var queue = this.playerInputQueues[playerId];

            // create an array of inputs for this step, if one doesn't already exist
            if (!queue[data.step]) queue[data.step] = [];

            // add the input to the player's queue
            queue[data.step].push(data);
        }

        // an input has been received from a client, queue it for next step

    }, {
        key: 'onReceivedInput',
        value: function onReceivedInput(data, socket) {
            if (this.connectedPlayers[socket.id]) {
                this.connectedPlayers[socket.id].socket.lastHandledInput = data.messageIndex;
            }

            this.resetIdleTimeout(socket);

            this.queueInputForPlayer(data, socket.playerId);
        }

        /**
         * Report game status
         * This method is only relevant if the game uses MatchMaker functionality.
         * This method must return the game status.
         *
         * @return {String} Stringified game status object.
         */

    }, {
        key: 'gameStatus',
        value: function gameStatus() {
            var gameStatus = {
                numPlayers: Object.keys(this.connectedPlayers).length,
                upTime: 0,
                cpuLoad: 0,
                memoryLoad: 0,
                players: {}
            };

            var _iteratorNormalCompletion7 = true;
            var _didIteratorError7 = false;
            var _iteratorError7 = undefined;

            try {
                for (var _iterator7 = Object.keys(this.connectedPlayers)[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
                    var p = _step7.value;

                    gameStatus.players[p] = {
                        frameRate: 0
                    };
                }
            } catch (err) {
                _didIteratorError7 = true;
                _iteratorError7 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion7 && _iterator7.return) {
                        _iterator7.return();
                    }
                } finally {
                    if (_didIteratorError7) {
                        throw _iteratorError7;
                    }
                }
            }

            return JSON.stringify(gameStatus);
        }
    }]);

    return ServerEngine;
}();

export default ServerEngine;