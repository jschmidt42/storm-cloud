/* global requirejs */
(function () {
    'use strict';

    function _module(_) {

        var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
        var ARGUMENT_NAMES = /([^\s,]+)/g;

        _.mixin({
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
            }
        });

        return _;
    }

    if ((typeof define !== 'undefined' && define) && (typeof requirejs !== 'undefined' && requirejs)) {
        // requirejs
        define(['lodash'], _module);
    } else if (module && require) {
        // nodejs
        module.exports = _module(require(global.__base + 'node_modules/lodash'));
    }
}());
