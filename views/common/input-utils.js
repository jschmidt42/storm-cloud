"use strict";

define(function () {

    var exports = {};

    var InputType = {
        keydown: 0,
        keyup: 1,
        keypress: 2,
        mousedown: 3,
        mouseup: 4,
        mousemove: 5,
        mousewheel: 6
    };

    function jsToStingrayButton(btn) {
        if (btn == 1)
            return 2;
        if (btn == 2)
            return 1;
        return btn;
    }

    function InputForwarder(canvas, opts) {
        this.canvas = canvas;

        this.opts = opts || {};

        this.eventQueue = [];

        this.initEvents();

        // No context menu on canvas forwarded
        this.canvas.on("contextmenu", function() {
            return false;
        });
    }

    InputForwarder.prototype = {
        initEvents: function () {
            var that = this;
            var repeatState = {};
            this.registerEvent('keydown', function (e) {
                var key = e.which;

                // Override all browser shortcut if possible.
                e.stopPropagation();
                e.preventDefault();

                if (repeatState[key]) {
                    return;
                }

                repeatState[key] = true;

                var desc = {
                    key: e.keyCode
                };

                return that.captureEvent('keydown', desc);
            });

            this.registerEvent('keyup', function (e) {
                var key = e.which;
                repeatState[key] = false;

                var desc = {
                    key: e.keyCode
                };

                e.stopPropagation();
                e.preventDefault();

                return that.captureEvent('keyup', desc);
            });

            this.registerEvent('mousedown touchstart', function (e) {
                var desc = {
                    button: jsToStingrayButton(e.button)
                };

                // Ensure we always focus the canvas when clicking in it even if we prevent default.
                that.canvas.focus();

                // Lock the pointer on the canvas.
                if (e.button === 2 && e.ctrlKey) {
                    e.target.requestPointerLock();
                }

                e.stopPropagation();
                e.preventDefault();

                return that.captureEvent('mousedown', desc);
            });

            this.registerEvent('mouseup touchend', function (e) {
                var desc = {
                    button: jsToStingrayButton(e.button)
                };

                e.stopPropagation();
                e.preventDefault();

                return that.captureEvent('mouseup', desc);
            });

            this.registerEvent('mousemove touchmove', function (e) {
                var desc = {
                    dx: e.originalEvent.movementX,
                    dy: e.originalEvent.movementY,
                    x: e.originalEvent.offsetX,
                    y: that.canvas.height() - e.offsetY
                };

                return that.captureEvent('mousemove', desc);
            });

            this.registerEvent('mousewheel', function (e) {
                var desc = {
                    dx: -e.deltaX,
                    dy: -e.deltaY,
                    dz: -e.deltaZ
                };

                return that.captureEvent('mousewheel', desc);
            });
        },

        registerEvent: function (type, handler, capture) {
            var that = this;
            var eventHandler = handler;
            if (this.opts.eventBroadcaster) {
                eventHandler = function (e) {
                    var inputStreamingEvent = handler.call(that, e);
                    that.opts.eventBroadcaster(type, e, inputStreamingEvent);
                };
            }

            $(this.canvas[0]).bind(type, eventHandler, capture);
        },

        captureEvent: function (type, payload) {
            payload.input_type = InputType[type];
            this.eventQueue.push(payload);
            return payload;
        },

        flushQueue: function () {
            this.eventQueue = [];
        }
    };

    exports.InputType = InputType;
    exports.InputForwarder = InputForwarder;

    return exports;
});
