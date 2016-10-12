
module.exports = (function () {

    "use strict";
    var path = require('path'),
        express = require('express'),
        logger = require('morgan'),
        opts = require('minimist')(process.argv.slice(2));

    function _getIP() {
        var os = require('os');

        var ip = null;
        var ifaces = os.networkInterfaces();

        Object.keys(ifaces).forEach(function (ifname) {
            var alias = 0;

            if (ip) {
                return;
            }

            ifaces[ifname].forEach(function (iface) {
                if ('IPv4' !== iface.family || iface.internal !== false) {
                    // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
                    return;
                }

                if (alias < 1) {
                    ip = iface.address;
                }
                ++alias;
            });
        });

        return ip;
    }

    /**
     * @constructor
     */
    function HttpService() {
        this.app = null;
        this.server = null;

        // Start http server to serve backend static files and requests.
        return this.createServer(parseInt(opts.port) || 80);
    }

    HttpService.prototype = {

        createServer: function (port) {
            return new Promise(resolve => {
                var favicon = require('serve-favicon');

                this.contentRoot = path.join(__dirname, '..', 'views');

                var app = express();

                app.use(logger('dev'));
                app.use(favicon(path.join(this.contentRoot, 'favicon.ico')));
                app.use(express.static(this.contentRoot));

                // Define global API
                app.get('/version', function (req, res) {
                    res.json(require('../package.json'));
                });

                // Start server and listen to connections
                var server = app.listen(port, function () {
                    var host = _getIP();
                    var port = server.address().port;
                    this.url = "http://" + host + ":" + port;
                    console.log('Http server started on http://%s:%s', host, port);
                    resolve(this);
                }.bind(this));

                this.app = app;
                this.server = server;
                return this.server;
            });
        },

        register: function (type, route/*, callback*/) {
            this.app[type].apply(this.app, [route].concat(Array.prototype.slice.call(arguments, 2)));
        },

        release: function () {
            this.server.close();
        }
    };

    return HttpService;
})();
