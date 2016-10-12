/*jshint strict:true, node:true, esversion:6 */

"use strict";

module.exports = (function() {

    var _ = require('lodash'),
        path = require('path'),
        fs = require('fs-extra'),
        fsUtils = require('../common/fs-utils'),
        child_process = require('child_process'),
        mkdirp = require('mkdirp'),
        async = require('async'),
        portscanner = require('portscanner'),
        express = require('express'),
        multer = require('multer'),
        packagesRoot = path.join(__dirname, '..', 'packages'),
        upload = multer({ dest: path.join(packagesRoot, '.uploads') }),
        unzip = require('unzip'),
        Connection = require('../common/connection'),
        opts = require('minimist')(process.argv.slice(2));

    // Static variables

    function _findExe(dir, cb) {
        fs.readdir(dir, function (err, files) {
            if(err) {
                console.error(err);
                return cb([]);
            }
            var iterator = function (file, cb) {
                fs.stat(path.join(dir, file), function (err, stats) {
                    if(err) {
                        console.error(err);
                        return cb(false);
                    }
                    //console.log(path.join(dir, file), stats);
                    cb(stats.isFile() && path.extname(file) === ".exe");
                });
            };
            async.filter(files, iterator, cb);
        });
    }

    /**
     * Service used to launch the Stingray engine runtime
     * i.e. "stingray_win64_dev_x64.exe" --data-dir "G:\storm-cloud-01_data\win32" --source-platform win32 --wait-for-debugger
     * @constructor
     */
    function RuntimeService(httpService) {

        this.httpService = httpService;
        this.runningApps = [];
        this.nextConsolePort = 16050;

        // Find the engine exe

        const engineConfig = opts.config || "dev";
        const engineExeFilename = "stingray_win64_" + engineConfig + ".exe";
        const subEngineExePath = path.join("engine", "win64", engineConfig, engineExeFilename);

        // Detect runtime exe path
        this.runtimeExePath = path.resolve(subEngineExePath);
        if (!fs.existsSync(this.runtimeExePath) && opts.binaries)
            this.runtimeExePath = path.resolve(path.join(opts.binaries, subEngineExePath));

        if (!fs.existsSync(this.runtimeExePath) && process.env.SR_BIN_DIR)
            this.runtimeExePath = path.resolve(path.join(process.env.SR_BIN_DIR, subEngineExePath));

        if (!fs.existsSync(this.runtimeExePath))
            throw new Error("Cannot find runtime executable at " + this.runtimeExePath + ". Use --binaries <path> or define $SR_BIN_DIR=<path>");

        this.packagesRoot = packagesRoot;
        this.corePath = path.resolve(path.join(path.dirname(this.runtimeExePath), "..", "..", "..")).replace(/\\/g, "/");
        this.runtimeExePath = this.runtimeExePath.replace(/\\/g, "/");

        console.log('Runtime: ' + this.runtimeExePath);
        console.log('Runtime core: ' + this.corePath);
        console.log('Packages: ' + this.packagesRoot);

        if (!fs.existsSync(this.packagesRoot)){
            console.log('Creating packages output folder...');
            fs.mkdirSync(this.packagesRoot);
        }

        httpService.app.use('/packages', express.static(this.packagesRoot));

        // Define API
        httpService.register('get', '/apps', this.routeGetApps.bind(this));
        httpService.register('get', '/app/:name', this.routeGetAppInfo.bind(this));
        httpService.register('post', '/upload', upload.single('file'), function (req, res) {
            var tmpPath = req.file.path;
            var targetPath = path.join(this.packagesRoot, ".uploads", req.file.originalname);
            var appName = req.file.originalname.replace(".zip", "");

            console.info('Uploaded', targetPath);

            if (fs.existsSync(targetPath)) {
                console.info('Removing previous uploaded package', targetPath);
                fs.unlinkSync(targetPath);
            }

            var src = fs.createReadStream(tmpPath);
            var dest = fs.createWriteStream(targetPath);

            src.pipe(dest);
            src.on('end', function() {
                fs.unlinkSync(tmpPath);
                var mainEntryFile = false;

                var tempOutputPath = path.join(this.packagesRoot, '.uploads', path.basename(tmpPath));
                console.log("Creating temp folder", tempOutputPath);
                fs.mkdirSync(tempOutputPath);

                // Unzip and process package
                console.info('Unzipping', targetPath);
                fs.createReadStream(targetPath).pipe(unzip.Parse())
                    .on('entry', function (entry) {
                        var fileName = entry.path;
                        var type = entry.type; // 'Directory' or 'File'
                        var outputPath = path.join(tempOutputPath, fileName);

                        //console.log("unzip", entry.type, fileName, outputPath);
                        if (fileName.indexOf("settings.ini") >= 0) {
                            mainEntryFile = outputPath;
                        }

                        if (type === "File") {
                            var parentDir = path.dirname(outputPath);
                            if (!fs.existsSync(parentDir)) {
                                mkdirp.sync(parentDir);
                            }
                            entry.pipe(fs.createWriteStream(outputPath));
                        }
                    }.bind(this))
                    .on('error', function (/*err*/) {
                        res.status(417).send("Failed unzipping package.");
                    }.bind(this))
                    .on('close', function () {
                        console.info('Done unzipping', targetPath, tempOutputPath);
                        if (!mainEntryFile) {
                            fsUtils.rmDir(tempOutputPath);
                            return res.status(417).send("Invalid package, no entry file found (i.e. settings.ini).");
                        }
                        var outputDir = path.join(this.packagesRoot, appName);
                        fsUtils.getDirItems(tempOutputPath, function (items) {
                            // Move temp folder
                            if (fs.existsSync(outputDir)) {
                                fsUtils.rmDir(outputDir);
                            }

                            var sourceDir = path.join(tempOutputPath, items[0]);
                            if (items.length !== 1 || !fs.statSync(sourceDir).isDirectory()) {
                                sourceDir = tempOutputPath;
                            }

                            fs.move(sourceDir, outputDir, function () {
                                // Clean up temp folder.
                                fsUtils.rmDir(tempOutputPath);

                                this.getAppInfo(appName, function (appInfo) {
                                    res.json(appInfo);
                                });
                            }.bind(this));
                        }.bind(this));
                    }.bind(this));
            }.bind(this));
            src.on('error', function(/*err*/) {
                res.status(417).send("Failed to unzip package.");
            });
        }.bind(this));

        httpService.register('get', '/run/:name', this.routeRunApp.bind(this));
        httpService.register('get', '/processes', this.routeGetRunningGames.bind(this));
        httpService.register('get', '/process/:pid', this.routeGetProcessInfo.bind(this));
        httpService.register('post', '/process/:pid/keep-a-live', this.routeKeepALive.bind(this));

        setInterval(function () {
            var now = new Date().getTime();
            _.each(this.runningApps.slice(), function (app) {
                if (app.keep < now) {
                    // Kill process
                    console.warn("Killing inactive process", app.pid);
                    process.kill(app.pid);
                }
            });
        }.bind(this), 10000);
    }

    RuntimeService.prototype = _.create(Object.prototype, {

        run: function (appName, appFolder, exe, args, consolePort, callback) {

            console.info("Launching", exe, args.join(" "));
            var engineProcess = child_process.spawn(exe, args, {
                cwd: appFolder,
                stdio: 'inherit'
            });

            engineProcess.on('error', function (err) {
                console.error("App", appName, "cannot be launched.", err);
            });
            engineProcess.on('exit', function (code, signal) {
                console.warn("App", appName, "exited with", code, signal || "no signal");

                // Remove the process from the list
                _.remove(this.runningApps, function (info) {
                    return info.pid === engineProcess.pid;
                });
            }.bind(this));

            var t = new Date();
            t.setSeconds(t.getSeconds() + 100);

            var runtimeInfo = {
                running: appName,
                pid: engineProcess.pid,
                ports: {
                    console: consolePort,
                },
                engine: exe,
                args: args,
                keep: t.getTime(),
                links: {
                    info: this.httpService.url + "/process/" + engineProcess.pid,
                    view: this.httpService.url + "/game.html?path=" + appName + "&pid=" + engineProcess.pid + "&viewer=true",
                    cmd: exe + " " + args.join(" ")
                }
            };

            this.runningApps.push(runtimeInfo);

            // Wait for viewport port to be open
            this.waitForViewportServerReady(consolePort, function (err) {
                runtimeInfo.ready = !err;
                if (runtimeInfo.ready) {
                    // Connect to the engine console server and inject some scripts.
                    this.consoleConnection = new Connection();
                    this.consoleConnection.connect('127.0.0.1', consolePort, [], function (err) {
                        if (err) {
                            runtimeInfo.ready = false;
                            return callback(err, runtimeInfo);
                        }

                        callback(null, runtimeInfo);
                    }.bind(this));
                } else {
                    callback(null, runtimeInfo);
                }
            }.bind(this), 10000);
        },

        waitForViewportServerReady: function (port, callback, maxWait, retry) {
            retry = retry || 0;
            maxWait = maxWait || 5000;
            portscanner.checkPortStatus(port, '127.0.0.1', function(err, status) {
                if (err || status !== "open") {
                    if (retry > 10) {
                        return callback(new Error("Can't query port " + port));
                    }

                    setTimeout(function () {
                        this.waitForViewportServerReady(port, callback, maxWait, retry+1);
                    }.bind(this), maxWait / 10);
                } else {
                    callback(null);
                }
            }.bind(this));
        },

        formatThumbnailPath: function (thumbPath) {
            return path.join('packages', path.relative(this.packagesRoot, thumbPath)).replace(/\\/g, "/");
        },

        getAppFolder: function (name) {
            return path.join(this.packagesRoot, name).replace(/\\/g, "/");
        },

        getAppInfo: function (name, callback) {
            var fullPath = this.getAppFolder(name);
            async.waterfall([function (next) {
                // Get package type

                // Check if raw project (needs compilation)
                var settingsPath = path.join(fullPath, 'settings.ini');
                fs.exists(settingsPath, function (exists) {
                    if (exists) {
                        // Check if WebGL2 package
                        fsUtils.getDirItems(fullPath, function (items) {
                            var webgl2MainFile = _.find(items, function (item) {
                                return item.match(/stingray_webgl.+\.html/i);
                            });

                            if (webgl2MainFile) {
                                return next(null, "webgl2", settingsPath);
                            }
                            return next(null, "source", settingsPath);
                        });
                    } else {
                        // Check if bundle
                        settingsPath = path.join(fullPath, 'bundled', 'settings.ini');
                        fs.exists(settingsPath, function (exists) {
                            if (exists) {
                                return next(null, "bundled", settingsPath);
                            }
                            return next(new Error('Invalid project'));
                        });
                    }
                });
            }, function (type, settingsPath, next) {
                // Get settings.ini data
                fs.readFile(settingsPath, 'utf8', function (err, settings) {
                    if (err) {
                        return next(err);
                    }

                    next(null, type, settings);
                });
            }, function (type, settings, next) {
                // Get project name
                var projectNameRx = /project_name\s*=\s*"?([^"]+)"?/g;
                var match = projectNameRx.exec(settings) || [null, name];
                next(null, type, match[1] !== "null" ? match[1] : null, settings);
            }, function (type, title, settings, next) {
                // Get project description
                var projectDescRx = /project_description\s*=\s*"([^"]+)"/g;
                var match = projectDescRx.exec(settings) || [null, name];
                next(null, type, title, match[1] !== "null" ? match[1] : null, settings);
            }, function (type, title, description, settings, next) {
                // Get thumbnail path
                var thumbPath = path.join(fullPath, 'thumbnail.png');
                fs.exists(thumbPath, function (exists) {
                    next(null, type, title, description, exists ? this.formatThumbnailPath(thumbPath) : null, settings);
                }.bind(this));
            }.bind(this), function (type, title, description, thumbnail, settings, next) {
                // Get index file if any
                if (type !== "webgl2") {
                    return next(null, type, title, description, thumbnail, settings, null);
                }

                fsUtils.getDirItems(fullPath, function (items) {
                    return next(null, type, title, description, thumbnail, settings, _.find(items, function (item) {
                        return item.match(/stingray_webgl.+\.html/i);
                    }));
                });
            }.bind(this), function (type, title, description, thumbnail, settings, indexFile, next) {

                // Bundle app info
                next(null, {
                    "type": type,
                    "title": title,
                    "description": description,
                    "path": name,
                    "thumbnail": thumbnail,
                    "settings": settings,
                    indexFile: indexFile,
                    "links" : {
                        "info": this.url + "/app/" + name,
                        "run": this.url + "/run/" + name
                    }
                });

            }.bind(this)], function (err, appInfo) {
                callback(err, appInfo);
            });
        },

        routeRunApp: function (req, res) {
            var appName = req.params.name;

            this.getAppInfo(appName, function (err, appInfo) {
                if (err) {
                    return res.status(404).send("Can't run app, it doesn't exist.");
                }

                var consolePort = this.nextConsolePort++;
                var runtimeArgs = [
                    "--silent-mode", //"--wait", "10",
                    "--viewport-provider", "--port", consolePort
                ];
                var appFolder = this.getAppFolder(appName);
                if (appInfo.type === "source") {

                    var dataPath = path.join(appFolder, "..", ".compiled", appName + "_data", "win32").replace(/\\/g, "/");

                    // Make sure the app data directory exists.
                    if (!fs.existsSync(dataPath)) {
                        mkdirp.sync(dataPath);
                    }

                    runtimeArgs = runtimeArgs.concat([
                        "--source-dir", appFolder,
                        "--data-dir", dataPath,
                        "--map-source-dir", "core", this.corePath,
                        "--map-source-dir", "gwnav", path.join(this.corePath, "editor", "plugins", "navigation"),
                        "--source-platform", "win32",
                        "--compile", "--continue"
                    ]);

                    this.run(appName, appFolder, this.runtimeExePath, runtimeArgs, consolePort, function (err, runtimeInfo) {
                        if (err) {
                            return res.status(424).json(runtimeInfo);
                        }
                        res.json(runtimeInfo);
                    });
                } else if (appInfo.type === "bundled") {
                    _findExe(appFolder, function (exes) {
                        this.run(appName, appFolder, exes[0], runtimeArgs, consolePort, function (err, runtimeInfo) {
                            if (err) {
                                return res.status(424).json(runtimeInfo);
                            }
                            res.json(runtimeInfo);
                        });
                    }.bind(this));
                } else {
                    throw new Error('Unknown app type.');
                }
            }.bind(this));
        },

        routeGetProcessInfo: function (req, res) {
            var pid = req.params.pid;
            var process = _.last(this.runningApps, function (p) {
                return p.pid === pid;
            });

            if (!process) {
                return res.status(404).send("Can't find process.");
            }

            // Wait for viewport port to be open
            this.waitForViewportServerReady(process.ports.console, function (err) {
                process.ready = !err;
                res.json(process);
            }.bind(this), 10000);
        },

        routeKeepALive: function (req, res) {
            var pid = req.params.pid;

            var process = _.last(this.runningApps, function (p) {
                return p.pid === pid;
            });

            if (!process) {
                return res.status(404).send("Can't find process.");
            }

            var t = new Date();
            t.setSeconds(t.getSeconds() + 60);
            process.keep = t.getTime();
            res.status(200).json(process);
        },

        routeGetRunningGames: function (req, res) {
            res.json(this.runningApps);
        },

        // Return the list of available applications
        routeGetApps: function (req, res) {
            var packagesRoot = this.packagesRoot;

            fsUtils.getDirs(packagesRoot, function (dirs) {
                var apps = [];
                async.each(dirs, function (dir, next) {

                    // Ignore data folders
                    if (dir[0] === '.' || _.endsWith(dir, "_data")) {
                        return next();
                    }

                    var fullPath = path.join(packagesRoot, dir);
                    this.getAppInfo(dir, function (err, appInfo) {
                        if (!err) {
                            console.info('Found', appInfo.type, 'project', fullPath);
                            apps.push(appInfo);
                        }
                        next();
                    });
                }.bind(this), function(/*err*/){
                    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
                    res.header('Expires', '-1');
                    res.header('Pragma', 'no-cache');
                    res.json(apps);
                });
            }.bind(this));
        },

        routeGetAppInfo: function (req, res) {
            var appName = req.params.name;
            this.getAppInfo(appName, function (err, appInfo) {
                if (err) {
                    res.status(404).send("App doesn't exist");
                } else {
                    res.json(appInfo);
                }
            });
        }
    });

    return RuntimeService;
})();
