/**
 * @module common/lodash-ext
 */
(function () {
    'use strict';

    function _module(_) {

        var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
        var ARGUMENT_NAMES = /([^\s,]+)/g;

        _.mixin({
            isNil: function (value) {
                return value === undefined || value === null;
            },

            isDefined: function (value) {
                return !_.isNil(value);
            },

            findByValues: function (collection, property, values) {
                return _.filter(collection, function (item) {
                    return _.contains(values, item[property]);
                });
            },

            addFixedProperty: function (obj, name, value) {
                Object.defineProperty(obj, name, {
                    value: value,
                    enumerable: false,
                    configurable: false,
                    writable: false
                });
            },

            addProperty: function (obj, name, onGet, onSet, notEnumerable) {

                var
                    oldValue = obj[name],
                    getFn = function () {
                        return onGet.apply(obj, [name, oldValue]);
                    },
                    setFn = function (newValue) {
                        oldValue = onSet.apply(obj, [name, newValue]);
                        return oldValue;
                    };

                // Modern browsers, IE9+, and IE8 (must be a DOM object),
                if (Object.defineProperty) {

                    Object.defineProperty(obj, name, {
                        get: getFn,
                        set: setFn,
                        enumerable: !notEnumerable,
                        configurable: true
                    });

                    // Older Mozilla
                } else if (obj.__defineGetter__) {
                    obj.__defineGetter__(name, getFn);
                    obj.__defineSetter__(name, setFn);
                } else {
                    throw new Error('Browser not supported');
                }
            },

            getParamNames: function (func) {
                var fnStr = func.toString().replace(STRIP_COMMENTS, '');
                var result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
                if (result === null) {
                    result = [];
                }
                return result;
            },

            toCamelCase: function (propertyName) {
                return propertyName.charAt(0).toLowerCase() + propertyName.slice(1);
            },

            toPascalCase: function (propertyName) {
                return propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
            },

            mapPropertiesCamelCase: function (dest, src) {
                _.each(Object.getOwnPropertyNames(src), function (keyName) {
                    if (keyName.charAt(0) !== '$') {
                        dest[_.toCamelCase(keyName)] = src[keyName];
                    }
                });

                src.onPropertyChanged(function (that, propertyName, value) {
                    dest[_.toCamelCase(propertyName)] = value;
                });
            },

            isEnumerable: function (obj) {
                return _.isObject(obj) || _.isArray(obj);
            },

            keyValueArrayToObj: function (array) {
                if (!_.isArray(array)) {
                    throw new Error('argument is not an array');
                }

                var obj = {};
                _.each(array, function (item) {
                    if (item.key && item.value) {
                        obj[item.key] = item.value;
                    }
                });
                return obj;
            },

            construct: function (constructor, args) {
                function F() {
                    return constructor.apply(this, args);
                }

                F.prototype = constructor.prototype;
                return new F();
            },

            updateBooleanValues: function (obj) {
                _.each(obj, function (value, key) {
                    if (_.isString(value)) {
                        if (value === 'true' || value === 'True') {
                            obj[key] = true;
                        } else if (value === 'false' || value === 'False') {
                            obj[key] = false;
                        }
                    }
                });
                return obj;
            },

            lshift: function (num, bits) {
                return num * Math.pow(2, bits);
            },

            toInt32: function (a, b, c, d) {
                return (d << 24) | (c << 16) | (b << 8) | a; // jshint ignore:line
            },

            toInt64: function (a, b, c, d, e, f, g, h) {
                return _.lshift(h, 56) + _.lshift(g, 48) + _.lshift(f, 40) + _.lshift(e, 32) + _.lshift(d, 24) + _.lshift(c, 16) + _.lshift(b, 8) + a;
            },

            loadFile: function (url, callback) {
                var request = new XMLHttpRequest();
                request.open('GET', url, true);
                request.addEventListener('load', function () {
                    callback(request.responseText);
                });
                request.send();
            },

            resolvePath: function (url) {
                if (location.protocol === "file:") {
                    if (url.indexOf('/core/') !== -1) {
                        var slashPos = location.pathname.lastIndexOf('/core');
                        var root = location.pathname.substr(0, slashPos + 1);
                        return location.protocol + "//" + root + url;
                    } else {
                        return url;
                    }
                } else {
                    return url;
                }
            },

            now: function () {
                return new Date().getTime();
            },

            prevent: function (e) {
                e.stopPropagation();
                e.preventDefault();
            },

            isSimpleValue: function (v) {
                var t = typeof v;
                return t === 'string' || t === 'number' || t === 'boolean' || v === null || v === undefined;
            },

            triggerAfterMultipleTimes: function (func, times, timeToLive) {
                var timeoutId = null,
                    occurrences = 0;

                function _trigger(args) {
                    func(args);
                    _reset();
                }

                function _reset() {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                    occurrences = 0;
                }

                return function (args) {
                    if ((++occurrences >= times) && timeoutId) {
                        _trigger(args);
                        return true;
                    } else {
                        occurrences = 1;
                        timeoutId = setTimeout(_reset, timeToLive);
                        return false;
                    }
                };
            },

            conditionnalTrigger: function (conditions, func) {
                conditions = conditions.slice();
                return function (condition) {
                    var foundIt = conditions.indexOf(condition);
                    if (foundIt !== -1) {
                        conditions.splice(foundIt, 1);
                        if (conditions.length === 0) {
                            func();
                        }
                    }
                };
            },

            escapeRegExp: function (str) {
                return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
            },

            replaceAll: function (str, search, replacement) {
                return str.replace(new RegExp(_.escapeRegExp(search), 'g'), replacement);
            },

            startsWith: function (string, prefix) {
                return string.slice(0, prefix.length) === prefix;
            },

            endsWith: function (str, suffix) {
                return str.indexOf(suffix, str.length - suffix.length) !== -1;
            },

            splitParentPropertyPath: function (path) {
                var lastDot = path.lastIndexOf('.');
                var parentPath = path.slice(0, lastDot);
                var property = path.slice(lastDot + 1);
                return {
                    parent: parentPath,
                    property: property
                };
            },

            getCustomPropertyDescriptors: function (obj) {
                return Object.keys(obj).reduce(function (descriptors, key) {
                    var desc = Object.getOwnPropertyDescriptor(obj, key);
                    if (desc && desc.set && desc.get) {
                        descriptors[key] = desc;
                    }
                    return descriptors;
                }, {});
            },

            transferCustomProperties: function (srcObj, dstObj) {
                var descriptors = _.getCustomPropertyDescriptors(srcObj);
                Object.defineProperties(dstObj, descriptors);
                return dstObj;
            },

            /**
             * if obj is a function, it will be wrapped so its result is a promise. If obj is a value, it will be converted to a promise.
             * @param {object} obj - value or function that needs to return a promise
             * @param {object} [owner] - optional "this" of the function to invoke
             * @returns {Function}
             *
             * function convertToUsDollars(value) {
             *    return value * 1.35;
             * }
             *
             * // Wrap a function:
             * var wrappedFunction = _.promise(convertToUsDollars);
             * wrappedFunction(10).then(function (usValue) {
             *     console.log('resolved to ', usValue, 'us dollars');
             * });
             *
             * // Test wrapping a value:
             * _.promise( convertToUsDollars(10) ).then(function (usValue) {
             *     console.log('resolved to ', usValue, 'us dollars');
             * });
             *
             */
            promise: function (obj, thisArg) {
                function ensurePromise (value) {
                    if (value instanceof Promise) {
                        return value;
                    } else {
                        return Promise.resolve(value);
                    }
                }

                if (typeof obj === 'function') {
                    return function () {
                        return ensurePromise(obj.apply(thisArg, arguments));
                    };
                }

                return ensurePromise(obj);
            },

            /**
             * Convert the specified functions of an object so they will return promise upon execution:
             *
             * var arrayBasedCollectionModel = m.property.defaultCollectionModel([1,3,4], function () { return 42; });
             *
             * var promiseBasedCollectionModel = _.promiseApi(arrayBasedCollectionModel, 'addElement', 'removeElement');
             *
             * promiseBasedCollectionModel.addElement().then(function () {
             *     // Promise resolved!
             * });
             *
             * @param {object} obj - object containing functions
             * @param {array<string>} rest of arguments - functions to make promise based.
             */
            promiseApi: function (obj) {
                var names = Array.prototype.slice.call(arguments, 1);
                _.each(names, function (functionName) {
                    var oldFunction = obj[functionName] || function () {};
                    obj[functionName] = _.promise(oldFunction.bind(obj));
                });
            }
        });

        return _;
    }

    if ((typeof define !== 'undefined' && define) && (typeof requirejs !== 'undefined' && requirejs)) { // jshint ignore:line
        // requirejs
        define(['lodash'], _module);
    } else if (module && require) {
        // nodejs
        //noinspection JSUnresolvedVariable
        module.exports = _module(require(global.__base + 'node_modules/lodash'));
    }
}());
