var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

import PhysicsEngine from './PhysicsEngine';
import TwoVector from '../serialize/TwoVector';
import HSHGCollisionDetection from './SimplePhysics/HSHGCollisionDetection';
import BruteForceCollisionDetection from './SimplePhysics/BruteForceCollisionDetection';

var dv = new TwoVector();
var dx = new TwoVector();

/**
 * SimplePhysicsEngine is a pseudo-physics engine which works with
 * objects of class DynamicObject.
 * The Simple Physics Engine is a "fake" physics engine, which is more
 * appropriate for arcade games, and it is sometimes referred to as "arcade"
 * physics. For example if a character is standing at the edge of a platform,
 * with only one foot on the platform, it won't fall over. This is a desired
 * game behaviour in platformer games.
 */

var SimplePhysicsEngine = function (_PhysicsEngine) {
    _inherits(SimplePhysicsEngine, _PhysicsEngine);

    /**
    * Creates an instance of the Simple Physics Engine.
    * @param {Object} options - physics options
    * @param {Object} options.collisions - collision options
    * @param {String} options.collisions.type - can be set to "HSHG" or "bruteForce".  Default is Brute-Force collision detection.
    * @param {Number} options.collisions.collisionDistance - for brute force, this can be set for a simple distance-based (radius) collision detection.
    * @param {Boolean} options.collisions.autoResolve - for brute force collision, colliding objects should be moved apart
    * @param {TwoVector} options.gravity - TwoVector instance which describes gravity, which will be added to the velocity of all objects at every step.  For example TwoVector(0, -0.01)
    */
    function SimplePhysicsEngine(options) {
        _classCallCheck(this, SimplePhysicsEngine);

        // todo does this mean both modules always get loaded?
        var _this = _possibleConstructorReturn(this, (SimplePhysicsEngine.__proto__ || Object.getPrototypeOf(SimplePhysicsEngine)).call(this, options));

        if (options.collisions && options.collisions.type === 'HSHG') {
            _this.collisionDetection = new HSHGCollisionDetection(options.collisions);
        } else {
            _this.collisionDetection = new BruteForceCollisionDetection(options.collisions);
        }

        /**
         * The actor's name.
         * @memberof SimplePhysicsEngine
         * @member {TwoVector} gravity affecting all objects
         */
        _this.gravity = new TwoVector(0, 0);

        if (options.gravity) _this.gravity.copy(options.gravity);

        var collisionOptions = Object.assign({ gameEngine: _this.gameEngine }, options.collisionOptions);
        _this.collisionDetection.init(collisionOptions);
        return _this;
    }

    // a single object advances, based on:
    // isRotatingRight, isRotatingLeft, isAccelerating, current velocity
    // wrap-around the world if necessary


    _createClass(SimplePhysicsEngine, [{
        key: 'objectStep',
        value: function objectStep(o, dt) {

            // calculate factor
            if (dt === 0) return;

            if (dt) dt /= 1 / 60;else dt = 1;

            // TODO: worldsettings is a hack.  Find all places which use it in all games
            // and come up with a better solution.  for example an option sent to the physics Engine
            // with a "worldWrap:true" options
            // replace with a "worldBounds" parameter to the PhysicsEngine constructor

            var worldSettings = this.gameEngine.worldSettings;

            // TODO: remove this code in version 4: these attributes are deprecated
            if (o.isRotatingRight) {
                o.angle += o.rotationSpeed;
            }
            if (o.isRotatingLeft) {
                o.angle -= o.rotationSpeed;
            }

            // TODO: remove this code in version 4: these attributes are deprecated
            if (o.angle >= 360) {
                o.angle -= 360;
            }
            if (o.angle < 0) {
                o.angle += 360;
            }

            // TODO: remove this code in version 4: these attributes are deprecated
            if (o.isAccelerating) {
                var rad = o.angle * (Math.PI / 180);
                dv.set(Math.cos(rad), Math.sin(rad)).multiplyScalar(o.acceleration).multiplyScalar(dt);
                o.velocity.add(dv);
            }

            // apply gravity
            if (!o.isStatic) o.velocity.add(this.gravity);

            var velMagnitude = o.velocity.length();
            if (o.maxSpeed !== null && velMagnitude > o.maxSpeed) {
                o.velocity.multiplyScalar(o.maxSpeed / velMagnitude);
            }

            o.isAccelerating = false;
            o.isRotatingLeft = false;
            o.isRotatingRight = false;

            dx.copy(o.velocity).multiplyScalar(dt);
            o.position.add(dx);

            o.velocity.multiply(o.friction);

            // wrap around the world edges
            if (worldSettings.worldWrap) {
                if (o.position.x >= worldSettings.width) {
                    o.position.x -= worldSettings.width;
                }
                if (o.position.y >= worldSettings.height) {
                    o.position.y -= worldSettings.height;
                }
                if (o.position.x < 0) {
                    o.position.x += worldSettings.width;
                }
                if (o.position.y < 0) {
                    o.position.y += worldSettings.height;
                }
            }
        }

        // entry point for a single step of the Simple Physics

    }, {
        key: 'step',
        value: function step(dt, objectFilter) {

            // each object should advance
            var objects = this.gameEngine.world.objects;
            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = Object.keys(objects)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var objId = _step.value;


                    // shadow objects are not re-enacted
                    var ob = objects[objId];
                    if (!objectFilter(ob)) continue;

                    // run the object step
                    this.objectStep(ob, dt);
                }

                // emit event on collision
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

            this.collisionDetection.detect(this.gameEngine);
        }
    }]);

    return SimplePhysicsEngine;
}(PhysicsEngine);

export default SimplePhysicsEngine;