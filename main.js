/* jshint node: true */
/* global process */

global.__base = __dirname + '/';

var _ = require('./common/lodash-ext'),
    fs = require('fs'),
    path = require('path'),
    async = require('async');

/**
 * Main entry point
 */
(function() {
    'use strict';

    var services = [];

    function findServiceByName(name) {
        return _.find(services, function (service) {
            return service.name === name;
        });
    }

    function getNestedDependencies(serviceName, closure, parentServiceName) {
        var service = findServiceByName(serviceName);

        if (!service) {
            throw new Error("Service " + serviceName + " doesn't exist.");
        }

        parentServiceName = parentServiceName || serviceName;
        closure = closure || [];
        var dependencies = _.map(service.dependencies, function (v) { return v.name || v; });

        dependencies.forEach(function (dep) {

            closure.push(dep);

            if (closure.indexOf(parentServiceName) >= 0) {
                throw new Error('Cyclic dependency found when resolving ' + (parentServiceName || "<none>") + ' and ' + serviceName);
            }

            var nestedDependencies = getNestedDependencies(dep, closure, parentServiceName);
            dependencies = _.union(dependencies, nestedDependencies);
        });

        return dependencies;
    }

    /**
     * Install service dependency injection and load all services.
     */
    function installServices() {
        var servicesFolderPath = path.join(__dirname, "services");
        var serviceScripts = fs.readdirSync(servicesFolderPath);
        _.each(serviceScripts, function (serviceScript) {

            var fullScriptPath = path.join(servicesFolderPath, serviceScript);

            /** @type {{
            *       script: {string} main script to require the service,
            *       module: {constructor} module to instantiate the service,
            *       name: {string} service name used for dependency injection
            *       instance: {object} instance of the service
            *   }}
             */
            var service = {
                script: fullScriptPath,
                module: require(fullScriptPath),
                name: null,
                instance: null,
                dependencies: []
            };

            // Get service dependencies and additional information
            service.name = _.toCamelCase(service.module.name);
            service.dependencies = _.getParamNames(service.module);

            services.push(service);
        });

        // Watch for service script changes.
        fs.watch(servicesFolderPath, function (event, filename) {
            if (event === "change" && filename) {
                var serviceScriptFullPath = path.join(servicesFolderPath, filename);
                _.find(services, function (service) {
                    if (service.script === serviceScriptFullPath) {
                        console.log('Reloading', filename);

                        // Find all services dependent on the current service
                        var dependents = _.filter(services, function (s) {
                            return _.map(s.dependencies, function (d) { return d.name || d; }).indexOf(service.name) >= 0;
                        });
                        dependents.push(service);

                        // Reload all dependencies
                        dependents.reverse().forEach(function (d) {

                            var cacheBck = require.cache[require.resolve(d.script)],
                                dModuleBck = d.module,
                                dInstanceBck = d.instance;
                            try {
                                // Delete previous module from cache
                                delete require.cache[require.resolve(d.script)];

                                // Reinstantiate service instance.
                                d.module = require(d.script);

                                if (_.isFunction(d.instance.release)) {
                                    d.instance.release();
                                }

                                delete d.instance;
                                resolveService(d.name).then(function (instance) {
                                    d.instance = instance;
                                });
                            } catch (err) {
                                require.cache[require.resolve(d.script)] = cacheBck;
                                d.module = dModuleBck;
                                d.instance = dInstanceBck;

                                console.warn("Failed to reload service.", err);
                            }
                        });
                    }
                });
            }
        });
    }

    /**
     * Resolve a single service.
     * @param {string} serviceName - service name
     * @returns {object} returns the resolved service instance, if any.
     */
    function resolveService(serviceName) {
        // Check if the request service exists.
        var service = findServiceByName(serviceName);

        if (!service) {
            return Promise.reject(new Error('Cannot found service ' + serviceName));
        }

        if (service.instance) {
            return Promise.resolve(service.instance);
        }

        // Gather all dependencies
        var allDependencies = getNestedDependencies(service.name);

        // Resolve dependencies
        return Promise.all(allDependencies.map(function (dependency) {
            return resolveService(dependency.name || dependency).then(function (resolvedDependency) {
                if (!resolvedDependency) {
                    throw new Error("Failed to resolve service dependency");
                }

                var depIndex = service.dependencies.indexOf(dependency);
                if (depIndex >= 0) {
                    service.dependencies[depIndex] = { name: dependency, instance: resolvedDependency };
                }
            });
        })).then(function () {
            // Create instance
            console.info("Created", service.name);
            return Promise.resolve(_.construct(service.module, _.pluck(service.dependencies, 'instance'))).then(function (instance) {
                service.instance = instance;
                return service.instance;
            });
        }).catch(function (err) {
            console.error(err);
            process.exit(-1);
        });
    }

    function resolveAllServices() {

        var dependencyMap = [];

        function _pushToDepMap(serviceName) {
            if (!_.find(dependencyMap, function (item) {
                    if (item.name === serviceName) {
                        item.count++;
                        return true;
                    }

                    return false;
                })) {
                dependencyMap.push({ name: serviceName, count: 1 });
            }
        }

        services.forEach(function (service) {
            _pushToDepMap(service.name);

            service.dependencies.forEach(function (dep) {
                _pushToDepMap(dep);
            });
        });

        var orderedServiceNamesByDependency = _.pluck(_.sortBy(dependencyMap, 'count').reverse(), 'name');

        return orderedServiceNamesByDependency.reduce(function(p, serviceName) {
            return p.then(function() {
                return resolveService(serviceName);
            });
        }, Promise.resolve()); // initial
    }

    /**
     * Starts the main node services.
     * @param {function} callback - Called when all main services are started and initialized.
     */
    function start(callback) {
        async.waterfall([
            function(next) {
                // Bootstrap services
                next();
            }
        ], function (err) {
            callback(err);
        });
    }

    installServices();
    resolveAllServices();
    start(function (err) {
        if (err) {
            console.error("Failed to start server.", err);
            return process.abort();
        }
    });

    process.on('SIGINT', function () {
        console.warn("Exiting...");
        process.exit();
    });
}());
