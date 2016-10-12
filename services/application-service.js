module.exports = (function() {

    "use strict";

    var _ = require('lodash');

    // Static variables

    function ApplicationService() {
    }

    ApplicationService.prototype = _.create(Object.prototype, {
        version: function () {
            return require('../package.json').version;
        }
    });

    return ApplicationService;
})();
