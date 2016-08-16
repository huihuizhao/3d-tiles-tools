'use strict';
var fsExtra = require('fs-extra');
var path = require('path');
var Promise = require('bluebird');
var combineTileset = require('../../lib/combineTileset');
var gzipTileset = require('../../lib/gzipTileset');

var fsExtraReadFile = Promise.promisify(fsExtra.readFile);
var fsExtraRemove = Promise.promisify(fsExtra.remove);

var tilesetDirectory = './specs/data/TilesetOfTilesets/';
var combinedDirectory = './specs/data/TilesetOfTilesets-combined';
var combinedJson = './specs/data/TilesetOfTilesets-combined/tileset.json';
var combinedJson2 = './specs/data/TilesetOfTilesets-combined/tileset3.json';
var gzippedDirectory = './specs/data/TilesetOfTilesets-gzipped';

function isGzipped(path) {
    return fsExtraReadFile(path)
        .then(function (data) {
            return (data[0] === 0x1f) && (data[1] === 0x8b);
        });
}

function getFilesInDirectory(directory) {
    return new Promise(function (resolve, reject) {
        var files = [];
        fsExtra.walk(directory)
            .on('data', function (item) {
                if (!item.stats.isDirectory()) {
                    files.push(path.relative(directory, item.path));
                }
            })
            .on('end', function () {
                resolve(files);
            })
            .on('error', reject);
    });
}

function isJson(file) {
    return path.extname(file) === '.json';
}

function getContentUrls(string) {
    var regex = new RegExp('"url": "(.*)"', 'g');
    var matches = [];
    var match = regex.exec(string);
    while (match !== null) {
        matches.push(match[1]);
        match = regex.exec(string);
    }
    return matches;
}

describe('combineTileset', function() {
    afterEach(function(done) {
        Promise.all([
            fsExtraRemove(gzippedDirectory),
            fsExtraRemove(combinedDirectory)
        ]).then(function() {
            done();
        });
    });

    it('combines external tilesets into a single tileset', function (done) {
        expect(combineTileset(tilesetDirectory, combinedDirectory)
            .then(function() {
                return getFilesInDirectory(combinedDirectory)
                    .then(function(files) {
                        // Check that only one tileset.json exists in the new directory
                        var length = files.length;
                        var numberOfJsonFiles = 0;
                        for (var i = 0; i < length; ++i) {
                            if (isJson(files[i])) {
                                ++numberOfJsonFiles;
                            }
                        }
                        expect(numberOfJsonFiles).toBe(1);
                        return fsExtraReadFile(combinedJson, 'utf8')
                            .then(function(contents) {
                                var matches = getContentUrls(contents);
                                expect(matches).toEqual(['parent.b3dm', 'tileset3/ll.b3dm', 'lr.b3dm', 'ur.b3dm', 'ul.b3dm']);
                            });
                    });
            }), done).toResolve();
    });

    it('works when no output directory is supplied', function (done) {
        expect(combineTileset(tilesetDirectory)
            .then(function() {
                // Just check that the output file exists
                return fsExtraReadFile(combinedJson);
            }), done).toResolve();
    });

    it('gzips if the original tileset.json is gzipped', function (done) {
        expect(gzipTileset(tilesetDirectory, gzippedDirectory)
            .then(function() {
                return combineTileset(gzippedDirectory, combinedDirectory)
                    .then(function() {
                        return isGzipped(combinedJson)
                            .then(function(gzipped) {
                                expect(gzipped).toBe(true);
                            });
                    });
            }), done).toResolve();
    });

    it('uses a different rootJson', function (done) {
        var options = {
            rootJson : 'tileset3/tileset3.json'
        };
        expect(combineTileset(tilesetDirectory, combinedDirectory, options)
            .then(function() {
                // Just check that the output file exists
                return fsExtraReadFile(combinedJson2);
            }), done).toResolve();
    });

    it('throws when no input tileset is given ', function () {
        expect(function() {
            combineTileset();
        }).toThrowDeveloperError();
    });

    it('throws when input tileset does not exist', function (done) {
        expect(combineTileset('non-existent-tileset', combinedDirectory), done).toRejectWith(Error);
    });

    it('writes debug info to console when verbose is true', function (done) {
        var options = {
            verbose : true
        };
        var spy = spyOn(console, 'log').and.callFake(function(){});
        expect(combineTileset(tilesetDirectory, gzippedDirectory, options)
            .then(function() {
                expect(spy).toHaveBeenCalled();
            }), done).toResolve();
    });
});
