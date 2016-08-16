'use strict';
var Cesium = require('cesium');
var fsExtra = require('fs-extra');
var path = require('path');
var Promise = require('bluebird');
var zlib = require('zlib');

var fsExtraCopy = Promise.promisify(fsExtra.copy);
var fsExtraOutputFile = Promise.promisify(fsExtra.outputFile);
var fsExtraOutputJson = Promise.promisify(fsExtra.outputJson);
var fsExtraReadFile = Promise.promisify(fsExtra.readFile);
var zlibGunzip = Promise.promisify(zlib.gunzip);
var zlibGzip = Promise.promisify(zlib.gzip);

var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;
var DeveloperError = Cesium.DeveloperError;

module.exports = combineTileset;

/**
 * Combines all external tilesets into a single tileset.json file.
 *
 * @param {String} inputDirectory Path to the tileset directory.
 * @param {Object} [outputDirectory] Path to the output directory.
 * @param {Object} [options] Object with the following properties:
 * @param {String} [options.rootJson='tileset.json'] Relative path to the root json.
 * @param {Boolean} [options.verbose=false] If true prints out debug messages to the console.
 */
function combineTileset(inputDirectory, outputDirectory, options) {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT);
    var rootJsonFile = defaultValue(options.rootJson, 'tileset.json');
    var verbose = defaultValue(options.verbose, false);

    if (!defined(inputDirectory)) {
        throw new DeveloperError('inputPath is required');
    }

    inputDirectory = path.normalize(inputDirectory);
    outputDirectory = path.normalize(defaultValue(outputDirectory,
        path.join(path.dirname(inputDirectory), path.basename(inputDirectory) + '-combined')));
    var outputJsonFile = path.join(outputDirectory, path.basename(rootJsonFile));
    rootJsonFile = path.join(inputDirectory, rootJsonFile);

    return processTileset(rootJsonFile, inputDirectory)
        .then(function (json) {
            // If the root json is originally gzipped, save the output json as gzipped
            return isGzippedFile(rootJsonFile)
                .then(function (gzipped) {
                    var promises = [];
                    if (gzipped) {
                        promises.push(outputJsonGzipped(outputJsonFile, json));
                    } else {
                        promises.push(outputJson(outputJsonFile, json));
                    }
                    promises.push(copyFiles(inputDirectory, outputDirectory, verbose));
                    return Promise.all(promises);
                });
        });
}

function processTileset(jsonFile, inputDirectory, parentTile) {
    return readTileset(jsonFile)
        .then(function (json) {
            var tilesetDirectory = path.dirname(jsonFile);
            var promises = [];
            var root = json.root;

            if (defined(root)) {
                // Append the external tileset to the parent tile
                if (defined(parentTile)) {
                    parentTile.content = root.content;
                    parentTile.children = root.children;
                }
                // Loop over all the tiles
                var stack = [];
                stack.push(root);
                while (stack.length > 0) {
                    var tile = stack.pop();
                    // Look for external tilesets
                    if (defined(tile.content)) {
                        var url = tile.content.url;
                        if (isJson(url)) {
                            // Load the external tileset
                            url = path.join(tilesetDirectory, url);
                            var promise = processTileset(url, inputDirectory, tile);
                            promises.push(promise);
                        } else {
                            // Make all content urls relative to the input directory
                            url = path.normalize(path.relative(inputDirectory, path.join(tilesetDirectory, tile.content.url)));
                            tile.content.url = url.replace(/\\/g, '/'); // Use forward slashes in the json
                        }
                    }
                    // Push children to the stack
                    var children = tile.children;
                    if (defined(children)) {
                        var length = children.length;
                        for (var i = 0; i < length; ++i) {
                            stack.push(children[i]);
                        }
                    }
                }
            }
            // Waits for all the external tilesets to finish loading before the promise resolves
            return Promise.all(promises)
                .then(function () {
                    return json;
                });
        });
}

function readTileset(tilesetJson) {
    return fsExtraReadFile(tilesetJson)
        .then(function (data) {
            if (isGzippedData(data)) {
                return zlibGunzip(data)
                    .then(function (data) {
                        return JSON.parse(data);
                    });
            } else {
                return JSON.parse(data);
            }
        });
}

function isGzippedData(data) {
    return (data[0] === 0x1f) && (data[1] === 0x8b);
}

function isGzippedFile(path) {
    return fsExtraReadFile(path)
        .then(function (data) {
            return isGzippedData(data);
        });
}

function isJson(file) {
    return path.extname(file) === '.json';
}

function outputJson(path, json) {
    return fsExtraOutputJson(path, json);
}

function outputJsonGzipped(path, json) {
    var jsonString = JSON.stringify(json);
    var buffer = new Buffer(jsonString);
    return zlibGzip(buffer)
        .then(function (buffer) {
            return fsExtraOutputFile(path, buffer);
        });
}

function copyFiles(inputDirectory, outputDirectory, verbose) {
    return new Promise(function (resolve, reject) {
        var files = [];
        var numberOfTilesets = 0;
        fsExtra.walk(inputDirectory)
            .on('data', function (item) {
                var isTileset = isJson(item.path);
                if (isTileset) {
                    ++numberOfTilesets;
                }
                // Don't copy tilesets
                if (!item.stats.isDirectory() && !isTileset) {
                    files.push(path.relative(inputDirectory, item.path));
                }
            })
            .on('end', function () {
                Promise.map(files, function (file) {
                    return fsExtraCopy(path.join(inputDirectory, file), path.join(outputDirectory, file));
                }, {concurrency: 1024})
                    .then(function() {
                        if (verbose) {
                            console.log('Combined ' + (numberOfTilesets - 1) + ' external tilesets.');
                        }
                        resolve();
                    })
                    .catch(reject);
            })
            .on('error', reject);
    });
}
