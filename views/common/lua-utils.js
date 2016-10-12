define(['lodash'], function(_) {
    'use strict';

    var exports = {};

    exports.toSyntax = function (obj) {
        if (obj === null || obj === undefined) {
            return "nil";
        }

        if (!_.isObject(obj)) {
            if (typeof obj === 'string') {
                return '"' + obj + '"';
            }
            return obj.toString();
        }

        var result = "{";
        var isArray = obj instanceof Array;
        var len = _.size(obj);
        var i = 0;
        _.forEach(obj, function (v, k) {
            if (isArray) {
                result += exports.toSyntax(v);
            } else {
                result += '["' + k + '"] = ' + exports.toSyntax(v);
            }
            if (i < len-1) {
                result += ",";
            }
            ++i;
        });
        result += "}";

        return result;
    };

    return exports;
});
