'use strict'

const afs = require('alex-async-fs');
const path = require('path');

const allowedSpecs = ['$this', '$all', '$else'];
const allowedHandlerNames = ['get.js', 'post.js'];

const methodsMap = {
    'get.js': 'GET',
    'post.js': 'POST'
}

const fsre = new RegExp('\\' + path.sep + '?[^\\' + path.sep + ']+', 'g');

function parseUrl(url)
{
    let parts = url.split(/\?|#/g);
    let query = {};
    for (let i = 1; i < parts.length; i++)
    {
        let kvs = parts[i].split('&');
        for (let j = 0; j < kvs.length; j++)
        {
            let kv = kvs[j].split('=');
            if (kv[0])
            {
                query[kv[0]] = kv[1];
            }
        }
    }
    return {
        target: parts[0],
        query
    }
}

function deepAddToObj(baseObj, addedObj)
{
    for (let key in addedObj)
    {
        if (baseObj[key] && addedObj[key] && typeof baseObj[key] == 'object' && typeof addedObj[key] == 'object')
        {
            deepAddToObj(baseObj[key], addedObj[key])
        }
        else
        {
            baseObj[key] = addedObj[key];
        }
    }
}

async function getHandler(routingMap, urlParts, index = -1)
{
    if (index == urlParts.length - 1 && routingMap.$this)
    {
        return routingMap.$this;
    }
    if (routingMap.$ddir)
    {
        let handler = await getDynamicHandler(routingMap.$ddir, urlParts, index);
        if (handler)
        {
            return handler;
        }
    }
    if (routingMap.$all)
    {
        return routingMap.$all;
    }
    let handler = null;
    if (urlParts[index + 1] && routingMap[urlParts[index + 1]])
    {
        handler = await getHandler(routingMap[urlParts[index + 1]], urlParts, index + 1);
    }
    if (handler)
    {
        return handler;
    }
    else if (routingMap.$else)
    {
        return routingMap.$else;
    }
    return null;
}

async function getDynamicHandler(ddir, urlParts, index)
{
    let dirParts = urlParts.slice(index + 1);
    let filePath = path.join(ddir.dir, ...dirParts);
    let stats = await afs.statAsync(filePath)
    if (stats)
    {
        if (stats.isDirectory())
        {
            filePath = path.join(filePath, ddir.defaultFileName);
            stats = await afs.statAsync(filePath);
            if (stats && !stats.isDirectory())
            {
                return {
                    [ddir.method]: async (ctx) =>
                    {
                        ctx.body = await afs.readFileAsync(filePath, { encoding: 'utf8' });
                        console.log('body', ctx.body);
                        return;
                    }
                }
            }
        }
        else
        {
            return {
                [ddir.method]: async (ctx) =>
                {
                    ctx.body = await afs.readFileAsync(filePath, { encoding: 'utf8' });
                    console.log('body', ctx.body);
                    return;
                }
            }
        }
    }
    return null;
}

class KoaRouter
{
    constructor(app, hostnameWhitelist)
    {
        if (!hostnameWhitelist)
        {
            hostnameWhitelist = [];
        }
        this._private = {};
        this._private.routingMap = {};
        this._private.dd = {};
        this._private.handle = async (ctx, next) =>
        {
            if (hostnameWhitelist.length > 0 && !hostnameWhitelist.includes(ctx.hostname))
            {
                next();
                return;
            }
            let url = parseUrl(ctx.url);
            let urlParts = url.target.match(/\/[^\/]+/g) || [];
            for (let i = 0; i < urlParts.length; i++)
            {
                urlParts[i] = urlParts[i].replace('/', '');
            }
            let handler = await getHandler(this._private.routingMap, urlParts);
            if (handler && handler[ctx.method])
            {
                let result = handler[ctx.method](ctx, next, urlParts, url.query);
                if (result instanceof Promise)
                {
                    await result;
                }
                return;
            }
            next();
        }
        app.use(this._private.handle);
    }

    getRoutingMap()
    {
        return this._private.routingMap;
    }

    addToRoutingMap(map)
    {
        deepAddToObj(this._private.routingMap, map);
    }

    removeFromRoutingMap(routeArray)
    {
        let mapRefs = [];
        if (routeArray.length < 1)
        {
            this._private.routingMap = {};
        }
        else
        {
            let map = this._private.routingMap;
            mapRefs.push(map);
            for (let i = 0; i < routeArray.length - 1; i++)
            {
                map = map[routeArray[i]];
                mapRefs.push(map);
            }
            delete map[routeArray[routeArray.length - 1]];
            while (mapRefs.length > 0)
            {
                map = mapRefs.pop();
                let el = routeArray.pop();
                let remove = true;
                for (let key in map[el])
                {
                    remove = false;
                }
                if (remove)
                {
                    delete map[el];
                }
                else
                {
                    break;
                }
            }
        }
    }

    addHandler(method, route, handler, type = '$this')
    {
        let routeParts = route.match(/\/[^\/]+/g) || [];
        let map = this._private.routingMap;
        for (let i = 0; i < routeParts.length; i++)
        {
            routeParts[i] = routeParts[i].replace('/', '');
            if (!map[routeParts[i]])
            {
                map[routeParts[i]] = {};
            }
            map = map[routeParts[i]];
        }
        if (!map[type])
        {
            map[type] = {};
        }
        map[type][method] = handler;
    }

    addIdenticalHandlers(method, routes, handler, type = '$this')
    {
        for (let i = 0; i < routes.length; i++)
        {
            this.addHandler(method, routes[i], handler, type = '$this');
        }
    }

    removeHandler(method, route, type = '$this')
    {
        let mapRefs = [];
        let routeParts = route.match(/\/[^\/]+/g) || [];
        let map = this._private.routingMap;
        mapRefs.push(map);
        for (let i = 0; i < routeParts.length; i++)
        {
            routeParts[i] = routeParts[i].replace('/', '');
            if (!map[routeParts[i]])
            {
                return;
            }
            map = map[routeParts[i]];
            mapRefs.push(map);
        }
        if (!map[type])
        {
            return;
        }
        delete map[type][method];
        routeParts.push(type);
        while (mapRefs.length > 0)
        {
            map = mapRefs.pop();
            let el = routeParts.pop()
            let remove = true;
            for (let key in map[el])
            {
                remove = false;
            }
            if (remove)
            {
                delete map[el];
            }
            else
            {
                break;
            }
        }
    }

    async addStaticDir(method, baseRoute, dir, defaultFileName)
    {
        let baseRouteParts = baseRoute.match(/\/[^\/]+/g) || [];
        let baseMap = this._private.routingMap;
        let files = await afs.readDirRecursiveAsync(dir);
        for (let i = 0; i < baseRouteParts.length; i++)
        {
            baseRouteParts[i] = baseRouteParts[i].replace('/', '');
            if (!baseMap[baseRouteParts[i]])
            {
                baseMap[baseRouteParts[i]] = {};
            }
            baseMap = baseMap[baseRouteParts[i]];
        }
        let map = baseMap;
        for (let i = 0; i < files.length; i++)
        {
            let handler = async (ctx) =>
            {
                ctx.body = await afs.readFileAsync(path.join(dir, files[i]), { encoding: 'utf8' });
                return;
            };
            let routeParts = files[i].match(fsre) || [];
            if (Array.isArray(routeParts))
            {
                for (let i = 0; i < routeParts.length; i++)
                {
                    routeParts[i] = routeParts[i].replace(path.sep, '');
                }
            }
            let lastIndex = routeParts.length - 1;
            for (let j = 0; j < lastIndex; j++)
            {
                if (!map[routeParts[j]])
                {
                    map[routeParts[j]] = {};
                }
                map = map[routeParts[j]];
            }
            if (routeParts[lastIndex] == defaultFileName)
            {
                if (!map.$this)
                {
                    map.$this = {};
                }
                map.$this[method] = handler;
            }
            if (!map[routeParts[lastIndex]])
            {
                map[routeParts[lastIndex]] = {};
            }
            map = map[routeParts[lastIndex]];
            if (!map.$this)
            {
                map.$this = {};
            }
            map.$this[method] = handler;
            map = baseMap;
        }
    }

    addDynamicDir(method, baseRoute, dir, defaultFileName)
    {
        let ddir = {
            dir,
            method,
            defaultFileName
        };
        let baseRouteParts = baseRoute.match(/\/[^\/]+/g) || [];
        let baseMap = this._private.routingMap;
        for (let i = 0; i < baseRouteParts.length; i++)
        {
            baseRouteParts[i] = baseRouteParts[i].replace('/', '');
            if (!baseMap[baseRouteParts[i]])
            {
                baseMap[baseRouteParts[i]] = {};
            }``
            baseMap = baseMap[baseRouteParts[i]];
        }
        baseMap.$ddir = ddir;
    }

    async addStaticHandlers(baseRoute, dir)
    {
        let baseRouteParts = baseRoute.match(/\/[^\/]+/g) || [];
        let baseMap = this._private.routingMap;
        let files = await afs.readDirRecursiveAsync(dir);
        for (let i = 0; i < baseRouteParts.length; i++)
        {
            baseRouteParts[i] = baseRouteParts[i].replace('/', '');
            if (!baseMap[baseRouteParts[i]])
            {
                baseMap[baseRouteParts[i]] = {};
            }
            baseMap = baseMap[baseRouteParts[i]];
        }
        let map = baseMap;
        for (let i = 0; i < files.length; i++)
        {
            let handler = require(path.join(dir, files[i]));
            let routeParts = files[i].match(fsre) || [];
            for (let i = 0; i < routeParts.length; i++)
            {
                routeParts[i] = routeParts[i].replace(path.sep, '');
            }
            if (routeParts.length < 2)
            {
                continue;
            }
            let specIndex = routeParts.length - 2;
            let handlerIndex = routeParts.length - 1;
            if (!allowedSpecs.includes(routeParts[specIndex]) || !allowedHandlerNames.includes(routeParts[handlerIndex]))
            {
                continue;
            }
            for (let j = 0; j < handlerIndex; j++)
            {
                if (!map[routeParts[j]])
                {
                    map[routeParts[j]] = {};
                }
                map = map[routeParts[j]];
            }
            let method = methodsMap[routeParts[handlerIndex]];
            map[method] = handler;
            map = baseMap;
        }
    }
}

module.exports = KoaRouter;
