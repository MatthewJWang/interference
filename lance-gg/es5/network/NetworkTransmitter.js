var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

import BaseTypes from '../serialize/BaseTypes';

import NetworkedEventFactory from './NetworkedEventFactory';
import NetworkedEventCollection from './NetworkedEventCollection';
import Utils from './../lib/Utils';

var NetworkTransmitter = function () {
    function NetworkTransmitter(serializer) {
        _classCallCheck(this, NetworkTransmitter);

        this.serializer = serializer;

        this.registeredEvents = [];

        this.serializer.registerClass(NetworkedEventCollection);

        this.registerNetworkedEventFactory('objectUpdate', {
            netScheme: {
                stepCount: { type: BaseTypes.TYPES.INT32 },
                objectInstance: { type: BaseTypes.TYPES.CLASSINSTANCE }
            }
        });

        this.registerNetworkedEventFactory('objectCreate', {
            netScheme: {
                stepCount: { type: BaseTypes.TYPES.INT32 },
                objectInstance: { type: BaseTypes.TYPES.CLASSINSTANCE }
            }
        });

        this.registerNetworkedEventFactory('objectDestroy', {
            netScheme: {
                stepCount: { type: BaseTypes.TYPES.INT32 },
                objectInstance: { type: BaseTypes.TYPES.CLASSINSTANCE }
            }
        });

        this.registerNetworkedEventFactory('syncHeader', {
            netScheme: {
                stepCount: { type: BaseTypes.TYPES.INT32 },
                // MJW added player count, probably shouldn't be here but I need it
                playerCount: { type: BaseTypes.TYPES.INT16 },
                fullUpdate: { type: BaseTypes.TYPES.UINT8 }
            }
        });

        this.networkedEventCollection = new NetworkedEventCollection();
    }

    _createClass(NetworkTransmitter, [{
        key: 'registerNetworkedEventFactory',
        value: function registerNetworkedEventFactory(eventName, options) {
            options = Object.assign({}, options);

            var classHash = Utils.hashStr(eventName);

            var networkedEventPrototype = function networkedEventPrototype() {};
            networkedEventPrototype.prototype.classId = classHash;
            networkedEventPrototype.prototype.eventName = eventName;
            networkedEventPrototype.netScheme = options.netScheme;

            this.serializer.registerClass(networkedEventPrototype, classHash);

            this.registeredEvents[eventName] = new NetworkedEventFactory(this.serializer, eventName, options);
        }
    }, {
        key: 'addNetworkedEvent',
        value: function addNetworkedEvent(eventName, payload) {
            if (!this.registeredEvents[eventName]) {
                console.error('NetworkTransmitter: no such event ' + eventName);
                return null;
            }

            var stagedNetworkedEvent = this.registeredEvents[eventName].create(payload);
            this.networkedEventCollection.events.push(stagedNetworkedEvent);

            return stagedNetworkedEvent;
        }
    }, {
        key: 'serializePayload',
        value: function serializePayload() {
            if (this.networkedEventCollection.events.length === 0) return null;

            var dataBuffer = this.networkedEventCollection.serialize(this.serializer);

            return dataBuffer;
        }
    }, {
        key: 'deserializePayload',
        value: function deserializePayload(payload) {
            return this.serializer.deserialize(payload.dataBuffer).obj;
        }
    }, {
        key: 'clearPayload',
        value: function clearPayload() {
            this.networkedEventCollection.events = [];
        }
    }]);

    return NetworkTransmitter;
}();

export default NetworkTransmitter;