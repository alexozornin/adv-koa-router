'use strict'

const afs = require('alex-async-fs');
const path = require('path');

const allowedSpecs = ['$this', '$all', '$else'];
const allowedHandlerNames = ['get.js', 'head.js', 'post.js', 'put.js', 'delete.js', 'connect.js', 'options.js', 'trace.js', 'patch.js'];

const methodsMap = {
    'get.js': 'GET',
    'head.js': 'HEAD',
    'post.js': 'POST',
    'put.js': 'PUT',
    'delete.js': 'DELETE',
    'connect.js': 'CONNECT',
    'options.js': 'OPTIONS',
    'trace.js': 'TRACE',
    'patch.js': 'PATCH',
}

const defaultEncodingMap = {
    '.html': 'utf8',
    '.js': 'utf8',
    '.css': 'utf8'
}

const defaultMimeMap = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.csv': 'text/csv',
    '.xml': 'text/xml',
    '.md': 'text/markdown',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.ogg': 'video/ogg',
    '.webm': 'video/webm',
    '.flv': 'video/flv',
    '.3gpp': 'video/3gpp',
    '.3gp': 'video/3gpp',
    '.3gpp2': 'video/3gpp2',
    '.3g2': 'video/3gpp2',
    '.aac': 'audio/aac',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/vnd.wave',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip'
}

const fsre = new RegExp('\\' + path.sep + '?[^\\' + path.sep + ']+', 'g');

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true);
        }, ms);
    })
}

function parseUrl(url) {
    let parts = url.split(/\?|#/g);
    let query = {};
    for (let i = 1; i < parts.length; i++) {
        let kvs = parts[i].split('&');
        for (let j = 0; j < kvs.length; j++) {
            let kv = kvs[j].split('=');
            if (kv[0]) {
                query[kv[0]] = kv[1];
            }
        }
    }
    return {
        target: parts[0],
        query
    }
}

function getExtension(name) {
    let parts = name.match(/\.[^\.]+/g);
    if (parts && parts[0]) {
        return parts[parts.length - 1].toLowerCase();
    }
    return '';
}

function deepAddToObj(baseObj, addedObj) {
    for (let key in addedObj) {
        if (baseObj[key] && addedObj[key] && typeof baseObj[key] == 'object' && typeof addedObj[key] == 'object') {
            deepAddToObj(baseObj[key], addedObj[key])
        }
        else {
            baseObj[key] = addedObj[key];
        }
    }
}

async function getHandler(routingMap, method, urlParts, index = -1) {
    if (index == urlParts.length - 1 && routingMap.$this && routingMap.$this[method]) {
        return routingMap.$this[method];
    }
    if (routingMap.$ddir && routingMap.$ddir.method == method) {
        let handler = await getDynamicHandler(routingMap.$ddir, urlParts, index);
        if (handler) {
            return handler;
        }
    }
    if (routingMap.$all && routingMap.$all[method]) {
        return routingMap.$all[method];
    }
    let handler = null;
    if (urlParts[index + 1] && routingMap[urlParts[index + 1]]) {
        handler = await getHandler(routingMap[urlParts[index + 1]], method, urlParts, index + 1);
    }
    if (handler) {
        return handler;
    }
    else if (routingMap.$else && routingMap.$else[method]) {
        return routingMap.$else[method];
    }
    return null;
}

async function getDynamicHandler(ddir, urlParts, index) {
    let dirParts = urlParts.slice(index + 1);
    let filePath = path.join(ddir.dir, ...dirParts);
    let stats = await afs.statAsync(filePath)
    if (stats) {
        if (stats.isDirectory()) {
            filePath = path.join(filePath, ddir.defaultFileName);
            stats = await afs.statAsync(filePath);
            if (stats && !stats.isDirectory()) {
                return async (ctx, next, urlParts, query, ...params) => {
                    if (ddir.checkAccessFunction) {
                        let check = ddir.checkAccessFunction(ctx, next, urlParts, query, ...params);
                        if (check instanceof Promise) {
                            check = await check;
                        }
                        if (!check) {
                            if (ddir.accessDeniedHandler) {
                                let result = ddir.accessDeniedHandler(ctx, next, urlParts, query, ...params);
                                if (result instanceof Promise) {
                                    await result;
                                }
                            }
                            else {
                                ctx.status = 400;
                                ctx.body = 'Access denied';
                            }
                            return;
                        }
                    }
                    let fsOptions = {};
                    let ext = getExtension(filePath);
                    if (ddir.encodingMap && ddir.encodingMap[ext]) {
                        fsOptions.encoding = ddir.encodingMap[ext];
                    }
                    if (ddir.mimeMap && ddir.mimeMap[ext]) {
                        ctx.type = ddir.mimeMap[ext];
                    }
                    ctx.body = await afs.readFileAsync(filePath, fsOptions);
                    return;
                }
            }
        }
        else {
            return async (ctx, next, urlParts, query, ...params) => {
                if (ddir.checkAccessFunction) {
                    let check = ddir.checkAccessFunction(ctx, next, urlParts, query, ...params);
                    if (check instanceof Promise) {
                        check = await check;
                    }
                    if (!check) {
                        if (ddir.accessDeniedHandler) {
                            let result = ddir.accessDeniedHandler(ctx, next, urlParts, query, ...params);
                            if (result instanceof Promise) {
                                await result;
                            }
                        }
                        else {
                            ctx.status = 400;
                            ctx.body = 'Access denied';
                        }
                        return;
                    }
                }
                let fsOptions = {};
                let ext = getExtension(filePath);
                if (ddir.encodingMap && ddir.encodingMap[ext]) {
                    fsOptions.encoding = ddir.encodingMap[ext];
                }
                if (ddir.mimeMap && ddir.mimeMap[ext]) {
                    ctx.type = ddir.mimeMap[ext];
                }
                ctx.body = await afs.readFileAsync(filePath, fsOptions);
                return;
            }
        }
    }
    return null;
}

class KoaRouter {
    /**
     * Creates an instance of KoaRouter
     * @param {*} app A Koa application
     * @param {Array} hostnameWhitelist An array of hostnames that should be routed by this instance of KoaRouter (leave blank for all hostnames)
     * @param {Object} options KoaRouter options
     * @param {Number} options.balanceCacheInterval Minimal interval in miliseconds between adaptive cache balance attempts (leave blank if balance not needed)
     */
    constructor(app, hostnameWhitelist, options) {
        if (!hostnameWhitelist) {
            hostnameWhitelist = [];
        }
        if (!options) {
            options = {};
        }
        if (!options.balanceCacheInterval) {
            options.balanceCacheInterval = 0;
        }
        this._private = {};
        this._private.options = options;
        this._private.routingMap = {};
        this._private.params = [];
        this._private.cache = {};
        this._private.adaptID = 0;
        this._private.adapts = {};
        this._private.lastBalance = options.balanceCacheInterval ? Date.now() + options.balanceCacheInterval : Number.MAX_SAFE_INTEGER;
        this._private.getAdaptID = () => {
            if (++this._private.adaptID >= Number.MAX_SAFE_INTEGER) {
                this._private.adaptID = 1;
            }
            return this._private.adaptID;
        }
        this.handle = async (ctx, next) => {
            if (hostnameWhitelist.length > 0 && !hostnameWhitelist.includes(ctx.hostname)) {
                next();
                return;
            }
            let url = parseUrl(ctx.url);
            let urlParts = url.target.match(/\/[^\/]+/g) || [];
            for (let i = 0; i < urlParts.length; i++) {
                urlParts[i] = urlParts[i].replace('/', '');
            }
            let handler = await getHandler(this._private.routingMap, ctx.method, urlParts);
            if (handler) {
                let result = handler(ctx, next, urlParts, url.query, ...this._private.params);
                if (result instanceof Promise) {
                    await result;
                }
                if (Date.now() - this._private.options.balanceCacheInterval > this._private.lastBalance) {
                    this.balanceCache();
                }
                return;
            }
            next();
            return;
        }
        this._private.adapt = (filePath, adaptID, data, type, bytes) => {
            if (this._private.adapts[adaptID].files[filePath]) {
                ++this._private.adapts[adaptID].files[filePath].reqs;
            }
            else {
                this._private.adapts[adaptID].files[filePath] = {
                    reqs: 1,
                    bytes
                }
            }
            if (!this._private.cache[filePath]) {
                if (this._private.adapts[adaptID].current + bytes <= this._private.adapts[adaptID].max) {
                    this._private.adapts[adaptID].current += bytes;
                    this._private.cache[filePath] = {
                        data,
                        type
                    }
                }
            }
        };
        if (app) {
            app.use(this.handle);
        }
    }

    /**
     * Returns current routing map
     */
    getRoutingMap() {
        return this._private.routingMap;
    }

    /**
     * Adds another routing map to current routing map
     * @param {Object} map Routing map
     */
    addToRoutingMap(map) {
        deepAddToObj(this._private.routingMap, map);
    }

    /**
     * Removes routes from the routing map
     * @param {Array} routeArray Array of routes to remove
     */
    removeFromRoutingMap(routeArray) {
        let mapRefs = [];
        if (routeArray.length < 1) {
            this._private.routingMap = {};
        }
        else {
            let map = this._private.routingMap;
            mapRefs.push(map);
            for (let i = 0; i < routeArray.length - 1; i++) {
                map = map[routeArray[i]];
                mapRefs.push(map);
            }
            delete map[routeArray[routeArray.length - 1]];
            while (mapRefs.length > 0) {
                map = mapRefs.pop();
                let el = routeArray.pop();
                let remove = true;
                for (let key in map[el]) {
                    remove = false;
                }
                if (remove) {
                    delete map[el];
                }
                else {
                    break;
                }
            }
        }
    }

    /**
     * Adds a handler to the routing map
     * @param {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} method HTTP method
     * @param {String} route Route of the handler
     * @param {Function} handler Handler function
     * @param {'$this' | '$all' | '$else'} type Handler type
     */
    addHandler(method, route, handler, type = '$this') {
        let routeParts = route.match(/\/[^\/]+/g) || [];
        let map = this._private.routingMap;
        for (let i = 0; i < routeParts.length; i++) {
            routeParts[i] = routeParts[i].replace('/', '');
            if (!map[routeParts[i]]) {
                map[routeParts[i]] = {};
            }
            map = map[routeParts[i]];
        }
        if (!map[type]) {
            map[type] = {};
        }
        map[type][method] = handler;
    }


    /**
     * Adds the same handlers for multiple routes to the routing map
     * @param {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} method HTTP method
     * @param {Array} routes Array of routes
     * @param {Function} handler Handler function
     * @param {'$this' | '$all' | '$else'} type Handler type
     */
    addIdenticalHandlers(method, routes, handler, type = '$this') {
        for (let i = 0; i < routes.length; i++) {
            this.addHandler(method, routes[i], handler, type);
        }
    }

    /**
     * Removes a handler from the routing map
     * @param {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} method HTTP method
     * @param {String} route Route of the handler
     * @param {'$this' | '$all' | '$else'} type Handler type
     */
    removeHandler(method, route, type = '$this') {
        let mapRefs = [];
        let routeParts = route.match(/\/[^\/]+/g) || [];
        let map = this._private.routingMap;
        mapRefs.push(map);
        for (let i = 0; i < routeParts.length; i++) {
            routeParts[i] = routeParts[i].replace('/', '');
            if (!map[routeParts[i]]) {
                return;
            }
            map = map[routeParts[i]];
            mapRefs.push(map);
        }
        if (!map[type]) {
            return;
        }
        delete map[type][method];
        routeParts.push(type);
        while (mapRefs.length > 0) {
            map = mapRefs.pop();
            let el = routeParts.pop()
            let remove = true;
            for (let key in map[el]) {
                remove = false;
            }
            if (remove) {
                delete map[el];
            }
            else {
                break;
            }
        }
    }

    /**
     * Serves a directory that cannot be changed over time
     * @param {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} method HTTP method
     * @param {String} baseRoute Starting route
     * @param {String} dir Path to a directory
     * @param {Object} options Serving options
     * @param {String} options.defaultFileName Filename, that should be also served by /
     * @param {Object} options.encodingMap File encoding map
     * @param {Object} options.mimeMap MIME type map
     * @param {Function} options.checkAccessFunction Function, checking for access rights
     * @param {Function} options.accessDeniedHandler Handler for rejected access
     * @param {'full' | 'adaptive' | 'none'} options.caching Type of RAM caching
     * @param {Number} options.cachingMaxRAM Maximum RAM used for adaptive caching in bytes
     */
    async addStaticDir(method, baseRoute, dir, options = {}) {
        if (!options.encodingMap) {
            options.encodingMap = defaultEncodingMap;
        }
        if (!options.mimeMap) {
            options.mimeMap = defaultMimeMap;
        }
        let baseRouteParts = baseRoute.match(/\/[^\/]+/g) || [];
        let baseMap = this._private.routingMap;
        let files = await afs.readDirRecursiveAsync(dir);
        for (let i = 0; i < baseRouteParts.length; i++) {
            baseRouteParts[i] = baseRouteParts[i].replace('/', '');
            if (!baseMap[baseRouteParts[i]]) {
                baseMap[baseRouteParts[i]] = {};
            }
            baseMap = baseMap[baseRouteParts[i]];
        }
        let map = baseMap;
        let extension;
        let fsOptions;
        let adaptID = 0;
        if (options.caching) {
            let filePath;
            let cache;
            switch (options.caching) {
                case 'full':
                    for (let i = 0; i < files.length; i++) {
                        filePath = path.join(dir, files[i]);
                        cache = {};
                        fsOptions = {};
                        extension = getExtension(files[i]);
                        if (options.encodingMap && options.encodingMap[extension]) {
                            fsOptions.encoding = options.encodingMap[extension];
                        }
                        if (options.mimeMap && options.mimeMap[extension]) {
                            cache.type = options.mimeMap[extension];
                        }
                        cache.data = await afs.readFileAsync(filePath, fsOptions);
                        this._private.cache[filePath] = cache;
                    }
                    break;
                case 'adaptive':
                    adaptID = this._private.getAdaptID();
                    this._private.adapts[adaptID] = {
                        current: 0,
                        max: options.cachingMaxRAM,
                        files: {},
                        options: {
                            encodingMap: options.encodingMap,
                            mimeMap: options.mimeMap
                        }
                    };
                    break;
                default:
                    break;
            }
        }
        for (let i = 0; i < files.length; i++) {
            let handler = async (ctx, next, urlParts, query, ...params) => {
                let filePath = path.join(dir, files[i]);
                if (options.checkAccessFunction) {
                    let check = options.checkAccessFunction(ctx, next, urlParts, query, ...params);
                    if (check instanceof Promise) {
                        check = await check;
                    }
                    if (!check) {
                        if (options.accessDeniedHandler) {
                            let result = options.accessDeniedHandler(ctx, next, urlParts, query, ...params);
                            if (result instanceof Promise) {
                                await result;
                            }
                        }
                        else {
                            ctx.status = 403;
                            ctx.body = 'Access denied';
                        }
                        return;
                    }
                }
                if (this._private.cache[filePath] && this._private.cache[filePath].data) {
                    if (this._private.cache[filePath].type) {
                        ctx.type = this._private.cache[filePath].type;
                    }
                    ctx.body = this._private.cache[filePath].data;
                }
                else {
                    let fsOptions = {};
                    let ext = getExtension(files[i]);
                    if (options.encodingMap && options.encodingMap[ext]) {
                        fsOptions.encoding = options.encodingMap[ext];
                    }
                    if (options.mimeMap && options.mimeMap[ext]) {
                        ctx.type = options.mimeMap[ext];
                    }
                    ctx.body = await afs.readFileAsync(filePath, fsOptions);
                }
                if (adaptID) {
                    let buffer = Buffer.from(ctx.body);
                    let bytes = buffer.length;
                    this._private.adapt(filePath, adaptID, ctx.body, ctx.type, bytes);
                }
                return;
            };
            let routeParts = files[i].match(fsre) || [];
            if (Array.isArray(routeParts)) {
                for (let i = 0; i < routeParts.length; i++) {
                    routeParts[i] = routeParts[i].replace(path.sep, '');
                }
            }
            let lastIndex = routeParts.length - 1;
            for (let j = 0; j < lastIndex; j++) {
                if (!map[routeParts[j]]) {
                    map[routeParts[j]] = {};
                }
                map = map[routeParts[j]];
            }
            if (routeParts[lastIndex] == options.defaultFileName) {
                if (!map.$this) {
                    map.$this = {};
                }
                map.$this[method] = handler;
            }
            if (!map[routeParts[lastIndex]]) {
                map[routeParts[lastIndex]] = {};
            }
            map = map[routeParts[lastIndex]];
            if (!map.$this) {
                map.$this = {};
            }
            map.$this[method] = handler;
            map = baseMap;
        }
    }

    /**
     * Serves a directory that can be changed over time
     * @param {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} method HTTP method
     * @param {String} baseRoute Starting route
     * @param {String} dir Path to a directory
     * @param {Object} options Serving options
     * @param {String} options.defaultFileName Filename, that should be also served by /
     * @param {Object} options.encodingMap File encoding map
     * @param {Object} options.mimeMap MIME type map
     * @param {Function} options.checkAccessFunction Function, checking for access rights
     * @param {Function} options.accessDeniedHandler Handler for rejected access
     */
    addDynamicDir(method, baseRoute, dir, options = {}) {
        if (!options.encodingMap) {
            options.encodingMap = defaultEncodingMap;
        }
        if (!options.mimeMap) {
            options.mimeMap = defaultMimeMap;
        }
        let ddir = {
            dir,
            method,
            defaultFileName: options.defaultFileName,
            encodingMap: options.encodingMap,
            mimeMap: options.mimeMap,
            checkAccessFunction: options.checkAccessFunction,
            accessDeniedHandler: options.accessDeniedHandler
        };
        let baseRouteParts = baseRoute.match(/\/[^\/]+/g) || [];
        let baseMap = this._private.routingMap;
        for (let i = 0; i < baseRouteParts.length; i++) {
            baseRouteParts[i] = baseRouteParts[i].replace('/', '');
            if (!baseMap[baseRouteParts[i]]) {
                baseMap[baseRouteParts[i]] = {};
            }
            baseMap = baseMap[baseRouteParts[i]];
        }
        baseMap.$ddir = ddir;
    }

    /**
     * Adds JavaScript handlers stored in a directory to the routing map
     * @param {String} baseRoute Starting route
     * @param {String} dir Path to a directory
     */
    async addStaticHandlers(baseRoute, dir) {
        let baseRouteParts = baseRoute.match(/\/[^\/]+/g) || [];
        let baseMap = this._private.routingMap;
        let files = await afs.readDirRecursiveAsync(dir);
        for (let i = 0; i < baseRouteParts.length; i++) {
            baseRouteParts[i] = baseRouteParts[i].replace('/', '');
            if (!baseMap[baseRouteParts[i]]) {
                baseMap[baseRouteParts[i]] = {};
            }
            baseMap = baseMap[baseRouteParts[i]];
        }
        let map = baseMap;
        for (let i = 0; i < files.length; i++) {
            let handler = require(path.join(dir, files[i]));
            let routeParts = files[i].match(fsre) || [];
            for (let i = 0; i < routeParts.length; i++) {
                routeParts[i] = routeParts[i].replace(path.sep, '');
            }
            if (routeParts.length < 2) {
                continue;
            }
            let specIndex = routeParts.length - 2;
            let handlerIndex = routeParts.length - 1;
            if (!allowedSpecs.includes(routeParts[specIndex]) || !allowedHandlerNames.includes(routeParts[handlerIndex])) {
                continue;
            }
            for (let j = 0; j < handlerIndex; j++) {
                if (!map[routeParts[j]]) {
                    map[routeParts[j]] = {};
                }
                map = map[routeParts[j]];
            }
            let method = methodsMap[routeParts[handlerIndex]];
            map[method] = handler;
            map = baseMap;
        }
    }

    /**
     * Adds params to be passed to all handlers
     * @param  {...any} params
     */
    addParams(...params) {
        this._private.params.push(...params);
    }

    /**
     * Sets params to be passed to all handlers
     * @param {Array} params
     */
    setParams(params) {
        this._private.params = params || [];
    }

    /**
     * Balances adaptive RAM cache
     */
    async balanceCache() {
        let cachedFiles = [];
        let uncachedFiles = [];
        for (let adaptID in this._private.adapts) {
            let adapt = this._private.adapts[adaptID];
            let files = [];
            for (let key in adapt.files) {
                files.push({
                    filePath: key,
                    reqs: adapt.files[key].reqs,
                    bytes: adapt.files[key].bytes,
                    options: adapt.options
                })
            }
            files.sort((a, b) => {
                if (b.reqs > a.reqs) {
                    return 1;
                }
                if (b.reqs < a.reqs) {
                    return -1;
                }
                return 0;
            });
            let usedBytes = 0;
            for (let i = 0; i < files.length; i++) {
                if (usedBytes + files[i].bytes <= adapt.max) {
                    usedBytes += files[i].bytes;
                    cachedFiles.push(files[i]);
                }
                else {
                    uncachedFiles.push(files[i]);
                }
            }
        }
        for (let i = 0; i < uncachedFiles.length; i++) {
            delete this._private.cache[uncachedFiles[i].filePath];
        }
        for (let i = 0; i < cachedFiles.length; i++) {
            if (!this._private.cache[cachedFiles[i].filePath]) {
                let cache = {};
                let fsOptions = {};
                let extension = getExtension(cachedFiles[i].filePath);
                if (cachedFiles[i].options.encodingMap && cachedFiles[i].options.encodingMap[extension]) {
                    fsOptions.encoding = cachedFiles[i].options.encodingMap[extension];
                }
                if (cachedFiles[i].options.mimeMap && cachedFiles[i].options.mimeMap[extension]) {
                    cache.type = cachedFiles[i].options.mimeMap[extension];
                }
                cache.data = await afs.readFileAsync(cachedFiles[i].filePath, fsOptions);
                this._private.cache[cachedFiles[i].filePath] = cache;
            }
        }
    }

    clearCache() {
        this._private.cache = {};
    }
}

module.exports = KoaRouter;
