/*jshint strict:true, esversion:6*/
/*globals Matrix */

require({
    paths: {
        "lodash": "/3rdparty/lodash/lodash.min",
        "sylvester": "/3rdparty/sylvester/sylvester",
        "sprintf": "/3rdparty/sprintf/sprintf.min",
        "lodash-ext": "/common/lodash-ext",
        "common": "/common",
        "broadway": "/3rdparty/broadway"
    }
}, [
    "lodash-ext",
    "common/gl-utils",
    "common/input-utils",
    "common/lua-utils",
    "sprintf",
    "broadway/Player"], function (_, glUtils, inputUtils, luaUtils, sprintf, Player) {

    "use strict";

    function H264Player(viewportContainer){
        var p = new Player({
            useWorker: true,
            workerFile: require.toUrl("broadway/Decoder.js")
        });

        p.canvas.setAttribute("class", "viewport");
        p.canvas.setAttribute("tabIndex", "1");
        p.canvas.addEventListener('click', function () {

        });

        p.onPictureDecoded = function () {
            FPS.tick();
        };

        p.canvas.addEventListener("webglcontextlost", function (event) {
            console.log("Lost WebGL Context");
        });

        viewportContainer[0].append(p.canvas);
        var parser = new nalParser(p);
        this.play = function(buffer){
            parser.parse(buffer);
        };
    }

    function nalParser(player){
        var bufferAr = [];
        var concatUint8 = function(parAr) {
            if (!parAr || !parAr.length){
                return new Uint8Array(0);
            }

            if (parAr.length === 1){
                return parAr[0];
            }

            var completeLength = 0;
            var i = 0;
            var l = parAr.length;
            for (i; i < l; ++i){
                completeLength += parAr[i].byteLength;
            }

            var res = new Uint8Array(completeLength);
            var filledLength = 0;

            for (i = 0; i < l; ++i){
                res.set(new Uint8Array(parAr[i]), filledLength);
                filledLength += parAr[i].byteLength;
            }
            return res;
        };
        this.parse = function(buffer){
            if (!(buffer && buffer.byteLength)){
                return;
            }
            var data = new Uint8Array(buffer);
            var hit = function(subarray){
                if (subarray){
                    bufferAr.push(subarray);
                }
                var buff = concatUint8(bufferAr);
                player.decode(buff);
                bufferAr = [];
            };

            var b = 0;
            var lastStart = 0;

            var l = data.length;
            var zeroCnt = 0;

            for (b = 0; b < l; ++b){
                if (data[b] === 0){
                    zeroCnt++;
                }else{
                    if (data[b] === 1){
                        if (zeroCnt >= 3){
                            if (lastStart < b - 3){
                                hit(data.subarray(lastStart, b - 3));
                                lastStart = b - 3;
                            }else if (bufferAr.length){
                                hit();
                            }
                        }
                    }
                    zeroCnt = 0;
                }
            }
            if (lastStart < data.length){
                bufferAr.push(data.subarray(lastStart));
            }
        };
    }

    var options = {
        fullscreen: false,
        commandline: false,
        logs: false
    };

    var captureOptionsHigh = {
        b: '8M',
        minrate: '8M',
        maxrate: '8M',
        bufsize: '8M',
        g: '10',
        qmin: '0',
        qmax: '18',
    };

    var captureOptionsMedium = {
        b: '1M',
        minrate: '1M',
        maxrate: '1M',
        bufsize: '1M',
        g: '5',
        qmin: '20',
        qmax: '30',
    };

    var captureOptionsLow = {
        b: '400k',
        minrate: '400k',
        maxrate: '400k',
        bufsize: '400k',
        g: '1',
        qmin: '30',
        qmax: '50',
    };

    if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
        captureOptionsHigh = {
            b: '200k',
            g: '10',
            qmin: '20',
            qmax: '40'
        }

        captureOptionsMedium = {
            b: '150k',
            g: '5',
            qmin: '30',
            qmax: '50'
        }

        captureOptionsLow = {
            b: '100k',
            g: '1',
            qmin: '40',
            qmax: '50'
        }
    }

    var scope = {};

    var _viewportContainer = $(".canvas-container");
    var h264p = new H264Player(_viewportContainer);
    var _viewport = $(".viewport");
    var _width = 0, _height = 0;
    var _viewportHandle = 1; // 1 = key to access largest swap chain.
    var _consoleSocket = null;
    var _viewportSocket = null;
    var _inputForwarder = null;

    scope.consolePort = 14030;
    scope.captureOptions = _getDefaultCaptureOptions();
    scope.nextFrameTimeout = 0;
    scope.requestTimeoutRequest = null;
    scope.lastResizeTime = _.now();
    scope.desiredRate = 10;

    var FPS = {
        _fps: 0,
        _frameCount: 0,
        _intervalId: null,
        _bandwidth: 0,
        _bandwidthSizes: [],
        init: function () {
            if (FPS._intervalId)
                clearTimeout(FPS._intervalId);

            // Create text nodes to save some time for the browser.
            var _timeNode = document.createTextNode("");
            var _sizeNode = document.createTextNode("");

            // Add those text nodes where they need to go
            var _debugInfoElement = $('.debug-info');
            _debugInfoElement.empty();
            _debugInfoElement.append(_timeNode);
            _debugInfoElement.append(document.createTextNode(" fps - "));
            _debugInfoElement.append(_sizeNode);
            _debugInfoElement.append(document.createTextNode(" kb/s  "));

            FPS._intervalId = setInterval(function () {
                FPS._fps = FPS._frameCount;
                FPS._frameCount = 0;

                FPS._bandwidth = 0;
                for (var s of FPS._bandwidthSizes) {
                    FPS._bandwidth += s;
                }
                FPS._bandwidthSizes.length = 0;

                _timeNode.nodeValue = FPS._fps.toFixed(1);
                _sizeNode.nodeValue = (FPS._bandwidth/ 1024).toFixed(1) ;
                _debugInfoElement[0].style.color = FPS.color();
            }, 1000);
        },

        color: function () {
            var fpsColor = "red";
            if (FPS._fps >= 24) {
                fpsColor = "chartreuse";
            } else if (FPS._fps > 20) {
                fpsColor = "YellowGreen";
            } else if (FPS._fps > 5) {
                fpsColor = "yellow";
            }
            return fpsColor;
        },

        tick: function () {
            ++FPS._frameCount;
        },

        current: function () {
            return FPS._fps;
        },

        newPacket: function (size) {
            FPS._bandwidthSizes.push(size);
        }
    };

    function _guid() {
        // RFC 4122 Version 4 Compliant solution:
        // From: http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }

    function getParameterByName(name) {
        name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
        var search = decodeURIComponent(location.search);
        var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
            results = regex.exec(search);
        return (results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " ")));
    }

    function _getDefaultCaptureOptions() {
        var quality = parseInt($('#inputQuality').val());

        switch (quality) {
            case 0: return captureOptionsLow;
            case 1: return captureOptionsMedium;
            case 2: return captureOptionsHigh;
            default: return captureOptionsHigh;
        }
    }

    function _requestViewportFrame() {
        if (!_viewportSocket)
            throw new Error("Can't request a frame when the socket is not initialized.");

        _viewportSocket.send(JSON.stringify({
            id: 0,
            handle: _viewportHandle,
            options: scope.captureOptions
        }));
    }

    function _sendInputs() {
        var eventQueue = _inputForwarder.eventQueue;
        if (eventQueue.length > 0) {
            _sendScript("stingray.Input.add_remote_events(" + luaUtils.toSyntax(eventQueue) + ")");
            _inputForwarder.flushQueue();
        }
    }

    function _viewportResized(force) {
        _viewport[0].style.width='100%';
        _viewport[0].style.height='100%';
        _viewport[0].width = _viewport[0].offsetWidth;
        _viewport[0].height = _viewport[0].offsetHeight;

        _width = _viewport[0].width;
        _height = _viewport[0].height;

        if(!force && (_.now() - scope.lastResizeTime) < 50) {
            clearTimeout(scope.viewportResizeTimeout);
            scope.viewportResizeTimeout = setTimeout(_viewportResized, 100);
            return;
        }

        _sendScript("stingray.Window.set_resolution(%d, %d)", _width, _height);
        if (_viewportSocket)
            setTimeout(_viewportSocket.send.bind(_viewportSocket, JSON.stringify({message: "resize"})), 50);

        scope.lastResizeTime = _.now();
    }

    function _onViewportMessageReceived(evt) {
        if (!evt.data)
            throw new Error("Invalid frame data");

        if (evt.data === "not_ready") {
            scope.requestTimeoutRequest = setTimeout(_requestViewportFrame, scope.nextFrameTimeout);
            return;
        }

        var frameBuffer = new Uint8Array(evt.data);

        FPS.newPacket(frameBuffer.length)

        h264p.play(frameBuffer);
    }

    function _initInputForwarding () {
        _viewport.focus();
        _inputForwarder = new inputUtils.InputForwarder(_viewport);
    }

    var _requests = {};
    function _sendRequest(command, argumentList, timeout) {
        var id = _guid();
        _requests[id] = {};
        _requests[id].promise = new Promise(function (resolve, reject) {
            var timeoutId = setTimeout(function () {
                reject('timeout');
            }, timeout || 1000);
            _requests[id].resolve = function (args) {
                clearTimeout(timeoutId);
                resolve(args);
            };
            _requests[id].reject = reject;
        });

        _sendToConsole({
            id: id,
            type: command,
            arg: argumentList
        });

        return _requests[id].promise;
    }

    function _createViewportServerConnection(viewportServerPort) {
        console.log('Creating viewport streaming connection');
        _viewportSocket = new WebSocket("ws://" + (window.location.hostname  || "127.0.0.1") + ":" + viewportServerPort);
        _viewportSocket.binaryType = "arraybuffer";
        _viewportSocket.onmessage = _onViewportMessageReceived;
        _viewportSocket.onopen = function() {
            console.log('Connection established with viewport server.');
            viewportReady(true);
            setInterval(_sendInputs, 30);
        };
        _viewportSocket.onclose = function(/*evt*/) {
            clearTimeout(scope.requestTimeoutRequest);
            console.warn('Closed viewport streaming connection.');
        };
        _viewportSocket.onerror = function(/*evt*/) {
            clearTimeout(scope.requestTimeoutRequest);
            console.error('Viewport streaming web socket error.');
        };
    }

    function _createConsoleConnection() {
        console.log('Creating console connection...');
        _consoleSocket = new WebSocket("ws://" + (window.location.hostname  || "127.0.0.1") + ":" + scope.consolePort);
        _consoleSocket.onmessage = function (evt) {
            var data = JSON.parse(evt.data);
            if (data.id && _requests.hasOwnProperty(data.id)) {
                _requests[data.id].resolve(data);
                delete _requests[data.id];
            } else if (options.logs && data.message) {
                var newMessageElem = $("<div>" + data.message.replace(/\n/g, "<br/>") + "</div>");
                $("#logsContainer").append(newMessageElem);
                newMessageElem[0].scrollIntoView();
            }
        };
        _consoleSocket.onopen = function() {
            console.log('Console connection open');
            var viewportServerPort = scope.consolePort + 10000;
            _sendRequest('viewport_server', {'start': viewportServerPort}).then(() => {_createViewportServerConnection(viewportServerPort);}).catch(function () {
                _consoleSocket.close();
                _createConsoleConnection();
            });
        };
        _consoleSocket.onclose = function(evt) {
            console.log('Console connection close', evt);
        };
        _consoleSocket.onerror = function(evt) {
            console.log('Console connection error', evt);
        };

        _initInputForwarding();
    }

    function _sendToConsole(content) {
        if (_consoleSocket === null || _consoleSocket.readyState !== 1) {
            return;
        }
        _consoleSocket.send(JSON.stringify(content));
    }

    function _sendScript(format) {
        var script = sprintf.vsprintf(format, Array.prototype.slice.call(arguments, 1));
        _sendToConsole({
            type: "script",
            script: script
        });
    }

    function _sendCommand(command) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (args.length === 1 && _.isArray(args[0])) {
            args = args[0];
        }
        console.log("#", command, args.join(" "));
        _sendToConsole({
            type: "command",
            command: command,
            arg: args
        });
    }

    function _viewportDestroyed() {
        clearTimeout(scope.requestTimeoutRequest);
    }

    function init() {

        function _showError(msg, reloadTimeout) {
            $(".status").html(msg);
            setTimeout(function () {
                window.location.reload();
            }, reloadTimeout || 10000);
        }

        var appName = getParameterByName("path");

        $.getJSON("/app/" + appName, function( appInfo ) {
            document.title = appInfo.title + " | Autodesk Stingray";

            scope.viewportId = appInfo.path;

            $(window).on('resize', _viewportResized);
            $(window).on('beforeunload', _viewportDestroyed);

            var is_safari = navigator.userAgent.indexOf("Safari") > -1;
            if (is_safari) {
                window.addEventListener("pagehide", _viewportDestroyed, false);
            }

            // Launch game
            scope.pid = getParameterByName("pid");
            if (scope.pid) {

                if (scope.pid === "debug") {
                    return _createConsoleConnection();
                } else {
                    // Keep a live
                    setInterval(function () {
                        $.post("/process/" + scope.pid + "/keep-a-live");
                    }, 10000);
                }

                $.getJSON("/process/" + scope.pid, function(runningInfo) {
                    scope.consolePort = runningInfo.ports.console;

                    if (runningInfo.ready) {
                        _createConsoleConnection();
                    } else {
                        _showError("<div><br/>Crunching bits for you...<br/><br/><a href='javascript:window.location.reload();'>Please retry later</a></div>", 5000);
                    }
                }).fail(function() {
                    var rerunUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?path=' + appName;
                    _showError("<div><br/>Can't find process (" + scope.pid + ")<br/><br/><a href='" + rerunUrl + "'>Re-run</a> | <a href='/'>Return</a></div>");
                });

            } else {
                $.getJSON("/run/" + appName, function(runningInfo) {
                    console.warn("Running", runningInfo);

                    var newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?path=' + appName + '&pid=' + runningInfo.pid;
                    if (history.pushState) {
                        window.history.pushState({path:newUrl},'',newUrl);
                    } else {
                        window.location.href = newUrl;
                    }

                    scope.consolePort = runningInfo.ports.console;

                    scope.pid = runningInfo.pid;

                    // Keep a live
                    setInterval(function () { $.post( "/process/" + scope.pid +"/keep-a-live"); }, 10000);

                    if (runningInfo.ready) {
                        _createConsoleConnection();
                    } else {
                        _showError("<div><br/>Game is currently compiling...<br/><br/><a href='javascript:window.location.reload();'>Please retry later</a></div>");
                    }
                }).fail(function() {
                    _showError("<div><br/>Can't launch application<br/><br/><a href='/'>Return</a></div>");
                });
            }
        }).fail(function() {
            _showError("<div><br/>No application named " + appName + "<br/><br/><a href='/'>Return</a></div>");
        });
    }

    function toggleOptions() {
        var elem = $(".panel-options");
        var hidden = elem.is(":hidden");
        elem.slideToggle('fast', function () {
            _viewportResized();
        });
        localStorage.setItem('showOptions', hidden ? "true" : "false");
    }

    function toggleFullScreen() {
        _viewport[0].width = window.innerWidth;
        _viewport[0].height = window.innerHeight;
        _viewport[0].webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
        _viewport[0].requestPointerLock();

        _viewportResized(true);
    }

    function togglePointerLock() {
        _viewport[0].requestPointerLock();
    }

    function toggleCommandLine() {
        options.commandline = !options.commandline;
        $("#btnCommandLine").toggleClass("toggle-on");
        $("#divCommandLine").slideToggle('fast', function () {
            _viewportResized();
        });
        localStorage.setItem('showCommandLine', options.commandline ? "true" : "false");

    }

    function toggleLogs() {
        options.logs = !options.logs;
        $("#btnLogs").toggleClass("toggle-on");
        $("#divLogs").slideToggle('fast', function () {
            _viewportResized();
        });
        localStorage.setItem('showLogs', options.logs ? "true" : "false");
    }

    function executeCommand() {
        var commandText = $("#commandText").val();
        if (commandText[0] === "#") {
            var c = commandText.slice(1).split(" ");
            _sendCommand(c[0], c.slice(1));
        } else {
            _sendScript(commandText);
        }
    }

    function viewportReady(ready) {
        if (!ready) {
            $(".spinner").show();
            $(".viewport, .viewport-overlay").hide();
            $(".viewport-btn").prop("disabled", true);
        } else {
            $(".spinner").hide();
            $(".viewport, .viewport-overlay").show(function () {
                _viewportResized();
                scope.requestTimeoutRequest = setTimeout(_requestViewportFrame, 0);
                _sendScript('stingray.Application.set_time_step_policy("throttle", 60)');
                _sendScript('stingray.Window.show_cursor(true)');
                _sendScript('stingray.Window.clip_cursor(false)');
            });
            $(".viewport-btn").prop("disabled", false);

            const ranges = [5, 15, 24, 30, 45, 60];
            setInterval(() => {
                var throttleRate = FPS._fps + 5;
                var dr = scope.desiredRate;
                for (let r of ranges) {
                    if (throttleRate >= r)
                        dr = r;
                    else if (throttleRate < r)
                        break;
                }
                if (scope.desiredRate != dr) {
                    scope.desiredRate = dr;
                    _sendScript(`stingray.Application.set_time_step_policy("throttle", ${dr.toFixed(0)})`);
                }
            }, 5000);

            setInterval(() => {
                let ri = ranges.findIndex(r => {
                    return r > scope.desiredRate;
                });
                if (ri !== -1 && ri < ranges.length) {
                    scope.desiredRate = ranges[ri];
                    _sendScript(`stingray.Application.set_time_step_policy("throttle", ${scope.desiredRate.toFixed(0)})`);
                }
            }, scope.desiredRate * 1000);

            FPS.init();
        }
    }

    // Expose global functions
    window.toggleOptions = toggleOptions;
    window.toggleFullScreen = toggleFullScreen;
    window.togglePointerLock = togglePointerLock;
    window.toggleCommandLine = toggleCommandLine;
    window.toggleLogs = toggleLogs;
    window.executeCommand = executeCommand;

    $( document ).ready(function() {

        if (localStorage.getItem('showOptions') === "true") {
            toggleOptions();

            if (localStorage.getItem('showCommandLine') === "true") {
                toggleCommandLine();
            }

            if (localStorage.getItem('showLogs') === "true") {
                toggleLogs();
            }
        }

        init();
        setTimeout(function () {
            $("#message-banner").fadeOut("slow");
        }, 3000);

        $('#inputQuality').on('change', function() {
            scope.captureOptions = _getDefaultCaptureOptions();
            if (_viewportSocket)
                _viewportSocket.send(JSON.stringify({message: "options", options: scope.captureOptions}))
            //_requestViewportFrame();
        });
    });
});
