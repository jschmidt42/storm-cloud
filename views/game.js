/*jshint strict:true, esversion:6*/
/*globals Matrix */

require({
    paths: {
        "lodash": "/3rdparty/lodash/lodash.min",
        "sylvester": "/3rdparty/sylvester/sylvester",
        "sprintf": "/3rdparty/sprintf/sprintf.min",
        "lodash-ext": "/common/lodash-ext",
        "common": "/common"
    }
}, [
    "lodash-ext",
    "common/gl-utils",
    "common/input-utils",
    "common/lua-utils",
    "sprintf"], function (_, glUtils, inputUtils, luaUtils, sprintf) {

    "use strict";

    var options = {
        fullscreen: false,
        commandline: false,
        logs: false
    };

    var CaptureMode = {
        CAPTURE_TYPE_UNKNOWN: 0,
        STREAMED_UNCOMPRESSED: 1,
        STREAMED_COMPRESSED: 2,
        STREAMED_COMPRESSED_LZ4: 3
    };

    var DctMethod = {
        JDCT_ISLOW: 0,
        JDCT_IFAST: 1,
        JDCT_FLOAT: 2
    };

    var FpsColor = {
        VerySlow: 0,
        Slow: 1,
        Good: 2,
        Excellent: 3
    };

    var scope = {};

    var _viewport = $(".viewport");
    var _viewportTextureId;
    var _width = 0, _height = 0;
    var _viewportHandle = 1; // 1 = key to access largest swap chain.
    var _consoleSocket = null;
    var _viewportSocket = null;
    var _inputForwarder = null;
    var gl = _viewport[0].getContext("webgl") || _viewport[0].getContext("experimental-webgl");

    // look up the elements we want to affect
    var _debugInfoElement = $('.debug-info')[0];

    // Create text nodes to save some time for the browser.
    var _timeNode = document.createTextNode("");
    var _sizeNode = document.createTextNode("");

    // Add those text nodes where they need to go
    _debugInfoElement.appendChild(_timeNode);
    _debugInfoElement.appendChild(document.createTextNode(" fps - "));
    _debugInfoElement.appendChild(_sizeNode);
    _debugInfoElement.appendChild(document.createTextNode(" kb   "));

    scope.consolePort = 14030;
    scope.lastMouseMoveTime = _.now();
    scope.captureMode = CaptureMode.STREAMED_COMPRESSED;
    scope.captureOptions = _getDefaultCaptureOptions(scope.captureMode);
    scope.fpsCounter = 0;
    scope.nextFrameTimeout = 0;
    scope.frameAveragingLength = 60;
    scope.bufferedTimes = [];
    scope.fpsColor = -1;
    scope.bufferedFrameSize = [];
    scope.requestTimeoutRequest = null;
    scope.lastRequestTime = _.now();
    scope.lastResizeTime = _.now();
    scope.touchMoveCoords = null;
    scope.frameImg = new Image();

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

    function _initShaders() {
        return Promise.all([
            glUtils.getShader(gl, "/shaders/viewport-streaming.fs", "x-shader/x-fragment"),
            glUtils.getShader(gl, "/shaders/viewport-streaming.vs", "x-shader/x-vertex")
        ]).then(function (shaders) {
            var fragmentShader = shaders[0];
            var vertexShader = shaders[1];
            var shaderProgram = gl.createProgram();
            gl.attachShader(shaderProgram, vertexShader);
            gl.attachShader(shaderProgram, fragmentShader);
            gl.linkProgram(shaderProgram);

            if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
                throw new Error("Can't link shader");
            }

            gl.useProgram(shaderProgram);

            scope.vertexPositionAttribute = gl.getAttribLocation(shaderProgram, "aVertexPosition");
            gl.enableVertexAttribArray(scope.vertexPositionAttribute);

            scope.textureCoordAttribute = gl.getAttribLocation(shaderProgram, "aTextureCoord");
            gl.enableVertexAttribArray(scope.textureCoordAttribute);

            scope.shaderProgram = shaderProgram;
        });
    }

    function _initBuffers() {
        scope.squareVerticesBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, scope.squareVerticesBuffer);

        var vertices = [
            1.0,  1.0,  0.0,
            -1.0, 1.0,  0.0,
            1.0,  -1.0, 0.0,
            -1.0, -1.0, 0.0
        ];

        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        scope.squareVerticesTextureCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, scope.squareVerticesTextureCoordBuffer);

        var texCoord = [
            1.0, 0.0,
            0.0, 0.0,
            1.0, 1.0,
            0.0, 1.0
        ];

        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoord), gl.STATIC_DRAW);
    }

    function _initWebGL() {
        gl.clearColor(0.152, 0.156, 0.160, 1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); // jshint ignore:line

        _viewportTextureId = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, _viewportTextureId);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        return _initShaders().then(function () {
            _initBuffers();

            scope.perspectiveMatrix = glUtils.makeOrtho(-1, 1, -1, 1, 0.0, 1.0);
            scope.mvMatrix = Matrix.I(4);

            var pUniform = gl.getUniformLocation(scope.shaderProgram, "uPMatrix");
            gl.uniformMatrix4fv(pUniform, false, new Float32Array(scope.perspectiveMatrix.flatten()));

            var mvUniform = gl.getUniformLocation(scope.shaderProgram, "uMVMatrix");
            gl.uniformMatrix4fv(mvUniform, false, new Float32Array(scope.mvMatrix.flatten()));

            scope.uSamplerLocation = gl.getUniformLocation(scope.shaderProgram, "uSampler");
        });
    }

    function _getFrameHeader(frameBuffer) {
        return {
            size: _.toInt32(frameBuffer[0], frameBuffer[1], frameBuffer[2], frameBuffer[3]),
            width: _.toInt32(frameBuffer[4], frameBuffer[5], frameBuffer[6], frameBuffer[7]),
            height: _.toInt32(frameBuffer[8], frameBuffer[9], frameBuffer[10], frameBuffer[11]),
            bpp: _.toInt32(frameBuffer[12], frameBuffer[13], frameBuffer[14], frameBuffer[15]),
            colorBufferSize: _.toInt32(frameBuffer[16], frameBuffer[17], frameBuffer[18], frameBuffer[19]),
            compressedColorBufferSize: _.toInt32(frameBuffer[20], frameBuffer[21], frameBuffer[22], frameBuffer[23]),
            depthBufferSize: _.toInt32(frameBuffer[24], frameBuffer[25], frameBuffer[26], frameBuffer[27])
        };
    }

    function _getFrameData(frameBuffer) {
        var header = _getFrameHeader(frameBuffer);
        var colorBuffer = frameBuffer.subarray(header.size);
        return {
            header:header,
            colorBuffer: colorBuffer
        };
    }

    function _drawTexture() {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, _viewportTextureId);
        gl.uniform1i(scope.uSamplerLocation, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, scope.squareVerticesBuffer);
        gl.vertexAttribPointer(scope.vertexPositionAttribute, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, scope.squareVerticesTextureCoordBuffer);
        gl.vertexAttribPointer(scope.textureCoordAttribute, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function _getDefaultCaptureOptions(captureMode) {
        if (captureMode === CaptureMode.STREAMED_COMPRESSED) {
            return {
                quality: 90,
                dctMethod: DctMethod.JDCT_IFAST
            };
        }
        return {};
    }

    function _updateFrameSize(frameSize) {
        // This function could be optimized a little
        if (scope.bufferedFrameSize.length >= scope.frameAveragingLength) {
            scope.bufferedFrameSize.shift();
        }
        scope.bufferedFrameSize.push(frameSize);

        var mean = 0;
        scope.bufferedFrameSize.forEach(function(size) {
            mean += size;
        });
        mean = mean / scope.bufferedFrameSize.length / 1024;

        _sizeNode.nodeValue = mean.toFixed(1);
    }

    /**
     * Updates label to display the frame counters
     * @TODO This function could be optimized a little
     * @param timeToRender delta time between each render
     * @private
     */
    function _updateFrameCounter(timeToRender) {
        if (scope.bufferedTimes.length >= scope.frameAveragingLength) {
            scope.bufferedTimes.shift();
        }
        scope.bufferedTimes.push(timeToRender);

        var meanTime = 0;
        scope.bufferedTimes.forEach(function(time) {
            meanTime += time;
        });
        meanTime = meanTime / scope.bufferedTimes.length;
        scope.fpsCounter = 1000 / meanTime;

        var fps = scope.fpsCounter.toFixed(1);
        if (fps > 30) {
            if (scope.fpsColor !== FpsColor.Excellent) {
                scope.fpsColor = FpsColor.Excellent;
                _debugInfoElement.style.color = "chartreuse";
            }
        } else if (fps > 20) {
            if (scope.fpsColor !== FpsColor.Good) {
                scope.fpsColor = FpsColor.Good;
                _debugInfoElement.style.color = "YellowGreen";
            }
        } else if (fps > 5) {
            if (scope.fpsColor !== FpsColor.Slow) {
                scope.fpsColor = FpsColor.Slow;
                _debugInfoElement.style.color = "yellow";
            }
        } else if (fps <= 5 && scope.fpsColor !== FpsColor.VerySlow) {
            scope.fpsColor = FpsColor.VerySlow;
            _debugInfoElement.style.color = "red";
        }

        _timeNode.nodeValue = fps;

        return _.now();
    }

    function _requestViewportFrame() {
        if (!_viewportSocket)
            throw new Error("Can't request a frame when the socket is not initialized.");

        _viewportSocket.send(JSON.stringify({
            id: scope.viewportId,
            type: scope.captureMode,
            //events: eventQueue,
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

    function _viewportRender(image) {

        if (image instanceof Image) {
            gl.bindTexture(gl.TEXTURE_2D, _viewportTextureId);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            _drawTexture();
        } else if (image.blob) {
            var imageBytes = new Uint8Array(image.blob);
            gl.bindTexture(gl.TEXTURE_2D, _viewportTextureId);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageBytes);
            _drawTexture();
        } else {
            throw new Error('Image format not supported');
        }

        scope.lastRequestTime = _updateFrameCounter(_.now() - scope.lastRequestTime);
    }

    function _viewportResized() {
        _viewport[0].style.width='100%';
        _viewport[0].style.height='100%';
        _viewport[0].width = _viewport[0].offsetWidth;
        _viewport[0].height = _viewport[0].offsetHeight;

        _width = _viewport[0].width;
        _height = _viewport[0].height;

        gl.viewport(0, 0, _width, _height);

        if((_.now() - scope.lastResizeTime) < 50) {
            clearTimeout(scope.viewportResizeTimeout);
            scope.viewportResizeTimeout = setTimeout(_viewportResized, 100);
            return;
        }

        _sendScript("stingray.Window.set_resolution(%d, %d)", _width, _height);

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
        var frame = _getFrameData(frameBuffer);

        _updateFrameSize(frameBuffer.length);

        if (scope.captureMode === CaptureMode.STREAMED_UNCOMPRESSED) {
            _viewportRender({
                blob: frame.colorBuffer,
                width: frame.header.width,
                height: frame.header.height,
                bpp: frame.header.bpp,
                size: frame.header.colorBufferSize
            });
        } else if (scope.captureMode === CaptureMode.STREAMED_COMPRESSED) {
            var blob = new Blob([frame.colorBuffer], {type: 'image/jpeg'});
            scope.frameImg.src = URL.createObjectURL(blob);
        } else {
            throw new Error('Not supported');
        }
    }

    function _initInputForwarding () {
        _viewport.focus();
        _inputForwarder = new inputUtils.InputForwarder(_viewport);
    }

    var _requests = {};
    function _sendRequest(command, timeout) {
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
            type: command
        });

        return _requests[id].promise;
    }

    function _createViewportServerConnection() {
        console.log('Creating viewport streaming connection');
        _viewportSocket = new WebSocket("ws://" + (window.location.hostname  || "127.0.0.1") + ":" + scope.consolePort + "/viewportserver");
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
            _sendRequest("is-ready").then(_createViewportServerConnection).catch(function () {
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

            /**
             * Initialize and construct the viewport
             */

            _initWebGL().then(function () {
                scope.frameImg.onload = function() {
                    _viewportRender(this);
                    URL.revokeObjectURL(scope.frameImg.src);
                };
                scope.frameImg.onerror = function() {
                    console.warn("Failed to load jpeg image.");
                };

                _viewportResized();

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
            });
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

        _viewportResized();
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
            });
            $(".viewport-btn").prop("disabled", false);
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
    });
});
